import bcrypt from 'bcrypt';

async function testPins() {
  // Existing hashes from our query
  const staffHashes = [
    { email: 'admin@admin.com', hash: '$2a$10$dLaJWLKpYx56LnGKvTx/OuvlPMH2mIjsJ8a4LmWdHx5s2gVk.9IoK' },
    { email: 'admin@system.com', hash: '$2a$10$x7FqCQvjzLRu7c7u1SU6aebrZp2KnxJzr5ki.T1X1Yu5VVyejBKJ.' },
    { email: 'waiter@admin.com', hash: '$2a$10$1/0HuhJlHu8KTkiw9xbAG.w3uHEHm.eOwf2n6m7QKsn2zr4KjftDW' },
  ];

  const testPins = ['000001', '000002', '000003', '123456', 'password']; // Common test pins

  for (const staff of staffHashes) {
    console.log(`Testing ${staff.email}...`);
    for (const pin of testPins) {
      const match = await bcrypt.compare(pin, staff.hash);
      if (match) {
        console.log(`✅ Match found for ${staff.email}: PIN is '${pin}'`);
        break;
      }
    }
  }
}

testPins();
