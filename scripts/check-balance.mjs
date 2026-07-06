// One-off diagnostic: replicate NombaService.fetchSubAccountBalance against the
// live API with a fresh env load. Prints status + shape only (no secrets).
import 'dotenv/config';
import axios from 'axios';

const raw = process.env.NOMBA_BASE_URL || 'https://sandbox.nomba.com';
const baseUrl = raw.replace(/\/(v\d+)?\/?$/i, '');
const accountId = process.env.NOMBA_ACCOUNT_ID;
const subAccountId = process.env.NOMBA_SUB_ACCOUNT_ID;
const clientId = process.env.NOMBA_CLIENT_ID;
const clientSecret = process.env.NOMBA_CLIENT_SECRET;

console.log('baseUrl        =', baseUrl);
console.log('accountId set  =', !!accountId);
console.log('subAccountId   =', subAccountId ? `${subAccountId.slice(0, 8)}… (len ${subAccountId.length})` : 'MISSING');

if (!subAccountId) { console.log('→ would return { available: false } (not configured)'); process.exit(0); }

try {
  const auth = await axios.post(
    `${baseUrl}/v1/auth/token/issue`,
    { grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret },
    { headers: { 'Content-Type': 'application/json', accountId }, timeout: 15000 },
  );
  const token = auth.data?.data?.access_token ?? auth.data?.access_token;
  console.log('token obtained =', !!token);

  const url = `${baseUrl}/v1/accounts/${subAccountId}/balance`;
  console.log('GET', url.replace(subAccountId, `${subAccountId.slice(0, 8)}…`));
  const res = await axios.get(url, { headers: { Authorization: `Bearer ${token}`, accountId }, timeout: 15000 });
  console.log('HTTP', res.status);
  console.log('body =', JSON.stringify(res.data, null, 2));
} catch (e) {
  console.log('ERROR', e?.response ? `HTTP ${e.response.status}` : e?.message);
  if (e?.response?.data) console.log('body =', JSON.stringify(e.response.data, null, 2));
}
