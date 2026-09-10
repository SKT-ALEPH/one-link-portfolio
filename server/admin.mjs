import { openStore, provision, hash, token, transaction } from './store.mjs';
const db = openStore();
const origin = process.env.APP_ORIGIN || 'http://localhost:5173';
const [command, value, variant] = process.argv.slice(2);
if (command === 'provision' && value) console.log(JSON.stringify(provision(db, value, origin, variant)));
else if (command === 'list') console.log(JSON.stringify(db.prepare('SELECT u.id,u.name,COUNT(c.id) AS passkeys FROM users u LEFT JOIN credentials c ON c.user_id=u.id GROUP BY u.id').all()));
else if (command === 'invite' && value) {
  if (!db.prepare('SELECT 1 FROM users WHERE id=?').get(value)) throw new Error('Unknown user');
  if (db.prepare('SELECT 1 FROM credentials WHERE user_id=?').get(value)) throw new Error('Use an existing passkey to add another');
  const secret = token();
  transaction(db, () => {
    db.prepare('DELETE FROM invitations WHERE user_id=?').run(value);
    db.prepare('INSERT INTO invitations VALUES (?,?,?)').run(hash(secret), value, Date.now() + 86400_000);
  });
  console.log(JSON.stringify({ url: `${origin}/private#enroll=${secret}` }));
} else throw new Error('Usage: provision NAME [owner|test] | list | invite USER_ID');
db.close();
