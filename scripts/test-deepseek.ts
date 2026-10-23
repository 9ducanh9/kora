import { DeepSeekArchitectureParser } from '../src/core/ai/providers/deepseek.parser';
import * as fs from 'fs';
import * as path from 'path';

// Load .env.local manually if running via tsx
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...valParts] = trimmed.split('=');
      const val = valParts.join('=').trim();
      if (key && val) {
        process.env[key.trim()] = val;
      }
    }
  }
}

async function testDeepSeek() {
  console.log('Testing DeepSeek Architecture Parser...');
  console.log('Key present:', Boolean(process.env.DEEPSEEK_KEY || process.env.DEEPSEEK_API_KEY));
  
  const parser = new DeepSeekArchitectureParser();
  const promptPath = path.resolve(process.cwd(), 'tests/fixtures/servicegremlin.prompt.txt');
  const testPrompt = fs.existsSync(promptPath) 
    ? fs.readFileSync(promptPath, 'utf8') 
    : `Users access CloudFront over HTTPS. CloudFront routes to S3 bucket and ALB. ALB forwards to ECS in VPC.`;
  
  const startTime = Date.now();
  try {
    const parsed = await parser.parse(testPrompt);
    const model = parsed.model;
    const duration = Date.now() - startTime;
    console.log(`DeepSeek parse succeeded in ${duration}ms!`);
    console.log(`Model: ${parser.getModelName()}`);
    console.log('Sample node with containerId:', model.nodes.find(n => n.containerId));
    console.log('All node containerIds:', model.nodes.map(n => ({ id: n.id, containerId: n.containerId })));
  } catch (err) {
    console.error('DeepSeek parse failed:', err);
  }
}

testDeepSeek();
