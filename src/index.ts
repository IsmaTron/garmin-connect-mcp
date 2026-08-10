import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { GarminClient } from './client';
import { createGarminServer } from './server';
import { startHttpServer } from './http';
import { formatError } from './utils';

async function runServer(): Promise<void> {
  const email = process.env.GARMIN_EMAIL;
  const password = process.env.GARMIN_PASSWORD;
  const mfaCode = process.env.GARMIN_MFA_CODE;
  const transportMode = process.env.MCP_TRANSPORT ?? 'stdio';
  const port = Number.parseInt(process.env.PORT ?? '', 10) || 3000;

  if (!email || !password) {
    console.error(
      'Error: GARMIN_EMAIL and GARMIN_PASSWORD environment variables are required.\n' +
        'Local (stdio):\n' +
        '  claude mcp add garmin -e GARMIN_EMAIL=you@email.com -e GARMIN_PASSWORD=yourpass -- npx -y @nicolasvegam/garmin-connect-mcp\n' +
        'Railway (HTTP): set them in your service under Variables (see RAILWAY.md)',
    );
    process.exit(1);
  }

  const promptMfa = mfaCode ? async () => mfaCode : undefined;
  const client = new GarminClient(email, password, promptMfa);

  if (transportMode === 'http') {
    startHttpServer(client, port);
    return;
  }

  const server = createGarminServer(client);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Garmin Connect MCP server running on stdio');
}

async function main(): Promise<void> {
  if (process.argv[2] === 'setup') {
    await import('./setup');
    return;
  }
  await runServer();
}

main().catch((error) => {
  console.error('Fatal error starting server:', formatError(error));
  process.exit(1);
});
