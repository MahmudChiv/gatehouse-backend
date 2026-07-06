// Demo seed (PRD §13). Bootstraps the Nest app context and drives the status mix
// through the REAL ingest/billing services so seeded data is engine-consistent.
// Run with: npm run db:seed  (requires DATABASE_URL + a reachable Postgres).
import { NestFactory } from '@nestjs/core';
import { randomBytes, randomUUID } from 'crypto';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { PaymentsService } from '../src/modules/payments/payments.service';
import { BillingService } from '../src/modules/billing/billing.service';

const FIRST = ['Adaeze', 'Chinedu', 'Tunde', 'Aisha', 'Femi', 'Yetunde', 'Ifeanyi', 'Bukola', 'Obinna', 'Hauwa', 'Segun', 'Ngozi', 'Kelechi', 'Funke', 'Emeka', 'Zainab', 'Olumide', 'Chiamaka', 'Babatunde', 'Folake', 'Uche', 'Halima', 'Tobi', 'Ibrahim'];
const LAST = ['Okafor', 'Adeyemi', 'Okonkwo', 'Bello', 'Eze', 'Mohammed', 'Abiola', 'Ogundimu', 'Nwosu', 'Lawal', 'Olaniyi', 'Aliyu', 'Onyema', 'Adebayo', 'Ibe', 'Yusuf'];

let seed = 7;
const rand = () => ((seed = (seed * 9301 + 49297) % 233280), seed / 233280);
const pick = <T>(a: T[]): T => a[Math.floor(rand() * a.length)];
const nuban = () => Array.from({ length: 10 }, () => Math.floor(rand() * 10)).join('');

const SERVICE_KOBO = 4_500_000; // ₦45,000
const day = 86_400_000;

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const prisma = app.get(PrismaService);
  const payments = app.get(PaymentsService);
  const billing = app.get(BillingService);
  const now = Date.now();

  const email = 'treasurer@maplecourt.ng';
  const existing = await prisma.manager.findUnique({ where: { email } });
  const manager =
    existing ??
    (await prisma.manager.create({
      data: { fullName: 'Bayo Okonkwo', email, phone: '+234 803 111 2222', hashedPassword: await bcrypt.hash('password', 10) },
    }));

  // Fresh estate each run keeps the seed deterministic.
  const estate = await prisma.estate.create({
    data: {
      managerId: manager.id,
      name: 'Maple Court',
      address: 'Plot 14 Admiralty Way',
      city: 'Lekki',
      state: 'Lagos',
      units: 60,
      cycleLabel: 'Q3 2026',
      allocationRule: 'OLDEST_FIRST',
      autoCreditThresholdKobo: 500_000,
      duplicateWindowSecs: 900,
    },
  });

  // Units + virtual accounts (written directly to keep seeding fast/offline).
  const unitRecords: { id: string; accountRef: string; occupant: string; unitName: string }[] = [];
  for (const block of ['A', 'B', 'C', 'D']) {
    for (let i = 1; i <= 15; i++) {
      const occupant = `${pick(FIRST)} ${pick(LAST)}`;
      const unit = await prisma.unit.create({
        data: {
          estateId: estate.id,
          block,
          unitName: `${block}${i}`,
          occupant,
          email: `${occupant.split(' ')[0].toLowerCase()}@example.ng`,
          type: rand() < 0.6 ? 'owner' : 'tenant',
        },
      });
      const accountRef = randomUUID();
      await prisma.account.create({
        data: { unitId: unit.id, accountNumber: nuban(), accountName: `Unit-${block}${i}`, bankName: 'Nomba MFB', accountRef },
      });
      await prisma.residentLink.create({ data: { unitId: unit.id, token: randomBytes(16).toString('hex') } });
      unitRecords.push({ id: unit.id, accountRef, occupant, unitName: `${block}${i}` });
    }
  }

  // Bill the cycle via the real service.
  await billing.createBillingRun(estate.id, {
    cycleLabel: 'Q3 2026',
    chargeAmountKobo: SERVICE_KOBO,
    dueDate: now + 5 * day,
    unitIds: unitRecords.map((u) => u.id),
  });

  const pay = (accountRef: string, amountKobo: number, sourceName: string, receivedAt: number) =>
    payments.ingestInboundPayment({ nombaTxnRef: `seed-${randomBytes(8).toString('hex')}`, accountRef, amountKobo, sourceName, receivedAt });

  // Status mix through the real ingest path.
  const normal = unitRecords.slice(0, -4);
  for (const u of normal) {
    const r = rand();
    const at = now - Math.floor(rand() * 25) * day;
    if (r < 0.62) await pay(u.accountRef, SERVICE_KOBO, u.occupant, at);
    else if (r < 0.8) await pay(u.accountRef, (Math.floor(15 + rand() * 20)) * 100_000, u.occupant, at);
    else if (r < 0.9) void 0; // unpaid
    else await pay(u.accountRef, SERVICE_KOBO + 200_000, u.occupant, at); // small overpay → credit
  }

  // Explicit exceptions (PRD §13).
  const [exOver, exDup, exThird] = unitRecords.slice(-4);
  await pay(exOver.accountRef, SERVICE_KOBO + 1_000_000, exOver.occupant, now - 30 * 60_000); // overpayment beyond threshold
  await pay(exDup.accountRef, SERVICE_KOBO, exDup.occupant, now - 20 * 60_000);
  await pay(exDup.accountRef, SERVICE_KOBO, exDup.occupant, now - 12 * 60_000); // duplicate
  await pay(exThird.accountRef, SERVICE_KOBO, 'Stephen Adewale (father)', now - 8 * 60_000); // third-party
  await payments.ingestInboundPayment({ nombaTxnRef: `seed-mis-${randomBytes(6).toString('hex')}`, accountRef: null, amountKobo: SERVICE_KOBO, sourceName: 'Chinedu Okafor', receivedAt: now - 6 * 60_000, estateIdHint: estate.id }); // misdirected

  // Vendors + payout history (direct writes to avoid live transfers during seed).
  const vendors = await Promise.all([
    prisma.vendor.create({ data: { estateId: estate.id, name: 'Sentinel Security Ltd', category: 'Security', bankName: 'GTBank', bankCode: '058', accountNumber: nuban() } }),
    prisma.vendor.create({ data: { estateId: estate.id, name: 'CleanCity Waste', category: 'Waste management', bankName: 'Access', bankCode: '044', accountNumber: nuban() } }),
    prisma.vendor.create({ data: { estateId: estate.id, name: 'Power & Diesel Co.', category: 'Diesel', bankName: 'Zenith', bankCode: '057', accountNumber: nuban() } }),
    prisma.vendor.create({ data: { estateId: estate.id, name: 'FixIt Estate Repairs', category: 'Repairs', bankName: 'UBA', bankCode: '033', accountNumber: nuban() } }),
  ]);
  const payouts = [
    { v: 0, kobo: 42_500_000, note: 'July security', ago: 28 },
    { v: 0, kobo: 42_500_000, note: 'August security', ago: 5 },
    { v: 1, kobo: 16_000_000, note: 'July waste', ago: 25 },
    { v: 2, kobo: 32_000_000, note: 'Diesel — July refill', ago: 18 },
    { v: 3, kobo: 19_000_000, note: 'Gatehouse roof repair', ago: 12 },
  ];
  for (const p of payouts) {
    await prisma.payout.create({
      data: { estateId: estate.id, vendorId: vendors[p.v].id, amountKobo: p.kobo, note: p.note, merchantTxRef: `seed-payout-${randomBytes(6).toString('hex')}`, status: 'SUCCESS', createdAt: new Date(now - p.ago * day) },
    });
  }

  console.log(`Seeded Maple Court estate ${estate.id}. Login: ${email} / password`);
  await app.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
