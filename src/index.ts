import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { GarminClient } from './client';
import { createGarminServer } from './server';
import { startHttpServer } from './http';

const GARMIN_EMAIL = process.env.GARMIN_EMAIL;
const GARMIN_PASSWORD = process.env.GARMIN_PASSWORD;
const GARMIN_MFA_CODE = process.env.GARMIN_MFA_CODE;
const MCP_TRANSPORT = process.env.MCP_TRANSPORT ?? 'stdio';
const PORT = Number.parseInt(process.env.PORT ?? '', 10) || 3000;

if (!GARMIN_EMAIL || !GARMIN_PASSWORD) {
  console.error(
    'Error: GARMIN_EMAIL and GARMIN_PASSWORD environment variables are required.\n' +
      'Local (stdio):\n' +
      '  claude mcp add garmin -e GARMIN_EMAIL=you@email.com -e GARMIN_PASSWORD=yourpass -- npx -y @nicolasvegam/garmin-connect-mcp\n' +
      'Railway (HTTP): set them in your service under Variables (see RAILWAY.md)',
  );
  process.exit(1);
}

const promptMfa = GARMIN_MFA_CODE ? async () => GARMIN_MFA_CODE : undefined;
const client = new GarminClient(GARMIN_EMAIL, GARMIN_PASSWORD, promptMfa);

async function main(): Promise<void> {
  if (MCP_TRANSPORT === 'http') {
    startHttpServer(client, PORT);
    return;
  }

  const server = createGarminServer(client);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Garmin Connect MCP server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error starting server:', error);
  process.exit(1);
});
