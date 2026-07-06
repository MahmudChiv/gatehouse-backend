// Definitive check: mint a JWT for a real manager and call the RUNNING server's
// authenticated /account-balance, to confirm the live process returns the balance.
import 'dotenv/config';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const prisma = new PrismaClient();
const manager = await prisma.manager.findFirst({ include: { estates: true } });
if (!manager) { console.log('No manager in DB'); process.exit(0); }
const estateId = manager.estates?.[0]?.id ?? '';
console.log('manager email =', manager.email, '| estateId =', estateId || 'none');

const token = jwt.sign({ sub: manager.id, email: manager.email }, process.env.JWT_SECRET, { expiresIn: '5m' });

const url = `http://localhost:3000/estate/${estateId}/account-balance`;
try {
  const res = await axios.get(url, { headers: { Authorization: `Bearer ${token}` } });
  console.log('HTTP', res.status, '\nbody =', JSON.stringify(res.data, null, 2));
} catch (e) {
  console.log('ERROR', e?.response ? `HTTP ${e.response.status}` : e?.message, JSON.stringify(e?.response?.data ?? {}));
}
await prisma.$disconnect();
