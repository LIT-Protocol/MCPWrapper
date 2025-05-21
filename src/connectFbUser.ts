import { config } from "dotenv";
import { ConnectionRequest, OpenAIToolSet } from "composio-core"; // Or framework-specific ToolSet

// load environment variables
config();

async function waitForActive(connectionRequest: ConnectionRequest) {
  // Assuming connectionRequest from step 2
  console.log("Waiting for connection to become active...");
  try {
    // This polls until the connection status is ACTIVE or timeout occurs
    const activeConnection = await connectionRequest.waitUntilActive(120); // Wait up to 2 minutes
    console.log(`Connection successful! ID: ${activeConnection.id}`);
    // Store activeConnection.id associated with userIdInMyApp
  } catch (e) {
    console.error("Connection timed out or failed:", e);
  }
}

async function initiate() {
  const toolset = new OpenAIToolSet({ apiKey: process.env.COMPOSIO_API_KEY });

  const entity = await toolset.getEntity("chris"); // Get Entity object

  // check existing connections
  const connections = await toolset.connectedAccounts.list({
    integrationId: process.env.COMPOSIO_FB_INTEGRATION_ID,
  });

  console.log("connections: ", connections);

  console.log(`Initiating fb connection for entity: ${entity.id}`);
  // Initiate connection using the app's Integration and the user's Entity ID
  const connectionRequest = await entity.initiateConnection({
    integrationId: process.env.COMPOSIO_FB_INTEGRATION_ID,
  });

  console.log("connectionRequest: ", connectionRequest);

  // Composio returns a redirect URL for OAuth flows
  if (connectionRequest.redirectUrl) {
    console.log(
      `Please direct the user to visit: ${connectionRequest.redirectUrl}`
    );
  }

  await waitForActive(connectionRequest);
}

initiate();
