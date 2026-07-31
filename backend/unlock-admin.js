require('dotenv').config({ path: '.env' });
const mongoose = require('mongoose');

(async () => {
  const uri = process.env.MONGODB_URI;
  const email = process.env.ADMIN_EMAIL || 'admin@example.com';

  if (!uri) {
    console.error('Missing MONGODB_URI');
    process.exit(1);
  }

  await mongoose.connect(uri);
  const result = await mongoose.connection.db.collection('users').updateOne(
    { email },
    { $set: { lockedUntil: null, failedLoginAttempts: 0, userStatus: 'active' } }
  );

  console.log(JSON.stringify({ email, matched: result.matchedCount, modified: result.modifiedCount }));
  await mongoose.disconnect();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
