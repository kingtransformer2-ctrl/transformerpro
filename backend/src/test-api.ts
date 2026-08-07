import { spawn } from 'child_process';
import axios from 'axios';

async function testApi() {
  console.log('Starting server...');
  const server = spawn('npx', ['tsx', 'src/server.ts'], {
    cwd: './',
    stdio: 'inherit'
  });
  // Wait a bit for server to start
  await new Promise(resolve => setTimeout(resolve, 3000));

  try {
    console.log('Testing API call...');
    const response = await axios.post('http://localhost:3000/api/rpc/verify_staff_pin', {
      staff_pin: '000001'
    });
    console.log('API response:', JSON.stringify(response.data, null, 2));
  } catch (err) {
    console.error('API call error:', (err as any).response?.data || (err as any).message);
  } finally {
    console.log('Killing server...');
    server.kill();
  }
}

testApi();
