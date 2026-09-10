import { openStore, transaction } from './store.mjs';
const db = openStore();
const allowed = ['live-check-A', 'live-check-B'];
const result = transaction(db, () => {
  let removed = 0;
  for (const name of allowed) {
    const users = db.prepare('SELECT id FROM users WHERE name=?').all(name);
    for (const user of users) {
      db.prepare('DELETE FROM challenges WHERE user_id=?').run(user.id);
      removed += Number(db.prepare('DELETE FROM users WHERE id=? AND name=?').run(user.id, name).changes);
    }
  }
  return removed;
});
console.log(`Removed ${result} temporary verification accounts.`);
db.close();
