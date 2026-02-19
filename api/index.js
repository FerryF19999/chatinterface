// Vercel Serverless API Handler with OpenClaw Gateway Integration
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const Pusher = require('pusher');
const { spawn } = require('child_process');
const WebSocket = require('ws');

// Initialize Pusher
const pusher = new Pusher({
  appId: process.env.PUSHER_APP_ID || 'your-app-id',
  key: process.env.PUSHER_KEY || 'your-key',
  secret: process.env.PUSHER_SECRET || 'your-secret',
  cluster: process.env.PUSHER_CLUSTER || 'ap1',
  useTLS: true
});

// OpenClaw Gateway configuration
const GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL || 'ws://127.0.0.1:18789';
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || null;

const app = express();
app.use(express.json());

// Agent definitions mapped to OpenClaw agents
const AGENTS = [
  { id: 'yuri', name: 'Yuri', color: '#FF6B6B', avatar: '👨‍🚀', status: 'offline', lastActivity: null, currentTask: null, role: 'agent', openclawAgent: 'yuri' },
  { id: 'jarvis', name: 'Jarvis', color: '#4ECDC4', avatar: '🤖', status: 'offline', lastActivity: null, currentTask: null, role: 'agent', openclawAgent: 'jarvis' },
  { id: 'friday', name: 'Friday', color: '#45B7D1', avatar: '👩‍💼', status: 'offline', lastActivity: null, currentTask: null, role: 'agent', openclawAgent: 'friday' },
  { id: 'glass', name: 'Glass', color: '#96CEB4', avatar: '🔍', status: 'offline', lastActivity: null, currentTask: null, role: 'agent', openclawAgent: 'glass' },
  { id: 'epstein', name: 'Epstein', color: '#DDA0DD', avatar: '🧠', status: 'offline', lastActivity: null, currentTask: null, role: 'agent', openclawAgent: 'epstein' }
];

// Owner profile (Ferry) - Has full control over all agents
const USERS = {
  ferry: { 
    id: 'ferry', 
    name: 'Ferry', 
    color: '#FFD700', 
    avatar: '👤', 
    status: 'online', 
    isUser: true,
    role: 'owner',
    roleLabel: 'Owner',
    canManageAgents: true,
    canCallAgents: true
  }
};

// Initialize agent states
let agentStates = {};
AGENTS.forEach(agent => {
  agentStates[agent.id] = { ...agent };
});

let chatMessages = [];
let activities = [];

// Helper to get sender info (agent or user)
function getSenderInfo(senderId) {
  if (USERS[senderId]) return USERS[senderId];
  return agentStates[senderId];
}

// Helper functions
function addActivity(agentId, type, description, metadata = {}) {
  const activity = {
    id: uuidv4(),
    agentId,
    type,
    description,
    timestamp: new Date(),
    metadata
  };
  activities.unshift(activity);
  if (activities.length > 100) activities.pop();
  
  // Trigger real-time update via Pusher
  pusher.trigger('dashboard', 'activity:new', activity);
  
  return activity;
}

function addMessage(fromAgentId, toAgentId, content, messageType = 'text') {
  const message = {
    id: uuidv4(),
    fromAgentId,
    toAgentId,
    content,
    messageType,
    timestamp: new Date(),
    read: false
  };
  chatMessages.push(message);
  if (chatMessages.length > 500) chatMessages.shift();
  
  const fromSender = getSenderInfo(fromAgentId);
  const targetName = toAgentId ? (getSenderInfo(toAgentId)?.name || toAgentId) : 'everyone';
  const senderName = fromSender?.name || fromAgentId;
  
  addActivity(fromAgentId, 'message', `${senderName} sent message to ${targetName}`, { messageId: message.id });
  
  // Trigger real-time update via Pusher
  pusher.trigger('dashboard', 'chat:message', message);
  
  return message;
}

// Fetch real agent status from OpenClaw Gateway
async function fetchGatewayHealth() {
  return new Promise((resolve, reject) => {
    const openclaw = spawn('openclaw', ['gateway', 'call', 'health', '--json']);
    let output = '';
    let error = '';
    
    openclaw.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    openclaw.stderr.on('data', (data) => {
      error += data.toString();
    });
    
    openclaw.on('close', (code) => {
      if (code !== 0) {
        console.error('Gateway health check failed:', error);
        reject(new Error(error || 'Gateway call failed'));
        return;
      }
      try {
        const health = JSON.parse(output);
        resolve(health);
      } catch (e) {
        reject(e);
      }
    });
  });
}

// Update agent states from Gateway health data
async function updateAgentStatesFromGateway() {
  try {
    const health = await fetchGatewayHealth();
    
    if (health.agents) {
      health.agents.forEach(gatewayAgent => {
        const agentId = gatewayAgent.agentId;
        if (agentStates[agentId]) {
          // Calculate status based on session activity
          const sessions = gatewayAgent.sessions || {};
          const recentSessions = sessions.recent || [];
          
          let status = 'offline';
          let lastActivity = null;
          
          if (recentSessions.length > 0) {
            const mostRecent = recentSessions[0];
            const ageMs = mostRecent.age || 0;
            lastActivity = new Date(Date.now() - ageMs);
            
            // If activity within last 5 minutes, consider online
            if (ageMs < 5 * 60 * 1000) {
              status = 'online';
            } else if (ageMs < 30 * 60 * 1000) {
              status = 'away';
            }
          }
          
          // Check if heartbeat is enabled
          if (gatewayAgent.heartbeat?.enabled) {
            status = 'online';
          }
          
          agentStates[agentId].status = status;
          agentStates[agentId].lastActivity = lastActivity;
          
          // Update current task if there's recent activity
          if (recentSessions.length > 0 && recentSessions[0].key) {
            const sessionKey = recentSessions[0].key;
            if (sessionKey.includes('cron')) {
              agentStates[agentId].currentTask = 'Running scheduled task';
            } else if (sessionKey.includes('subagent')) {
              agentStates[agentId].currentTask = 'Processing subagent task';
            } else {
              agentStates[agentId].currentTask = 'Active';
            }
          }
        }
      });
    }
    
    return health;
  } catch (error) {
    console.error('Failed to fetch Gateway health:', error);
    return null;
  }
}

// Call OpenClaw agent via CLI and get real response
async function callOpenClawAgent(agentId, message, userId = 'ferry') {
  const agent = agentStates[agentId];
  if (!agent) {
    throw new Error(`Unknown agent: ${agentId}`);
  }

  const openclawAgentId = agent.openclawAgent || agentId;
  
  return new Promise((resolve, reject) => {
    const args = [
      'agent',
      '--agent', openclawAgentId,
      '--message', message
    ];
    
    // Add timeout for longer responses
    const openclaw = spawn('openclaw', args, { 
      timeout: 120000,
      env: { ...process.env }
    });
    
    let output = '';
    let error = '';
    
    openclaw.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    openclaw.stderr.on('data', (data) => {
      error += data.toString();
    });
    
    openclaw.on('close', (code) => {
      if (code !== 0 && code !== null) {
        console.error(`Agent ${agentId} error:`, error);
        // Return a graceful fallback
        resolve(`I'm ${agent.name}, but I'm having trouble connecting right now. Please try again in a moment.`);
        return;
      }
      
      // Clean up the output - remove any CLI artifacts
      let response = output.trim();
      
      // If no output but also no error, provide a fallback
      if (!response && !error) {
        resolve(`Hello ${userId}! I'm ${agent.name}. How can I assist you today?`);
        return;
      }
      
      // If we have error but also some output, use output
      if (!response && error) {
        console.error('Agent returned error:', error);
        resolve(`Hello ${userId}! I'm ${agent.name}. I received your message but encountered a minor issue. How can I help?`);
        return;
      }
      
      resolve(response);
    });
    
    openclaw.on('error', (err) => {
      console.error(`Failed to spawn openclaw agent:`, err);
      resolve(`Hello ${userId}! I'm ${agent.name}. I'm currently unavailable, but I'll be back shortly.`);
    });
  });
}

// CORS middleware
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});

// Pusher auth endpoint for private channels
app.post('/api/pusher/auth', (req, res) => {
  const { socket_id, channel_name } = req.body;
  const auth = pusher.authorizeChannel(socket_id, channel_name);
  res.send(auth);
});

// Initialize endpoint
app.get('/api/init', async (req, res) => {
  // Update agent states from Gateway before sending response
  await updateAgentStatesFromGateway();
  
  res.json({
    agents: Object.values(agentStates),
    users: USERS,
    messages: chatMessages.slice(-50),
    activities: activities.slice(-20),
    pusherKey: process.env.PUSHER_KEY || 'your-key',
    pusherCluster: process.env.PUSHER_CLUSTER || 'ap1',
    gatewayConnected: true
  });
});

// Agent login
app.post('/api/agents/:id/login', async (req, res) => {
  const { id } = req.params;
  if (agentStates[id]) {
    agentStates[id].status = 'online';
    agentStates[id].lastActivity = new Date();
    
    const activity = addActivity(id, 'login', `${agentStates[id].name} is now online`);
    
    // Trigger agent update via Pusher
    pusher.trigger('dashboard', 'agent:updated', agentStates[id]);
    
    res.json(agentStates[id]);
  } else {
    res.status(404).json({ error: 'Agent not found' });
  }
});

// Agent logout
app.post('/api/agents/:id/logout', (req, res) => {
  const { id } = req.params;
  if (agentStates[id]) {
    agentStates[id].status = 'offline';
    agentStates[id].currentTask = null;
    
    const activity = addActivity(id, 'logout', `${agentStates[id].name} went offline`);
    
    // Trigger agent update via Pusher
    pusher.trigger('dashboard', 'agent:updated', agentStates[id]);
    
    res.json(agentStates[id]);
  } else {
    res.status(404).json({ error: 'Agent not found' });
  }
});

// Update agent status
app.put('/api/agents/:id/status', (req, res) => {
  const { id } = req.params;
  const { status, task } = req.body;
  
  if (agentStates[id]) {
    if (status) agentStates[id].status = status;
    if (task !== undefined) agentStates[id].currentTask = task;
    agentStates[id].lastActivity = new Date();
    
    if (task) {
      addActivity(id, 'task', `Working on: ${task}`);
    }
    
    // Trigger agent update via Pusher
    pusher.trigger('dashboard', 'agent:updated', agentStates[id]);
    
    res.json(agentStates[id]);
  } else {
    res.status(404).json({ error: 'Agent not found' });
  }
});

// Get all agents - with real Gateway status
app.get('/api/agents', async (req, res) => {
  // Update from Gateway before returning
  await updateAgentStatesFromGateway();
  res.json(Object.values(agentStates));
});

// Get single agent
app.get('/api/agents/:id', async (req, res) => {
  const agent = agentStates[req.params.id];
  if (agent) {
    // Update from Gateway
    await updateAgentStatesFromGateway();
    res.json(agentStates[req.params.id]);
  } else {
    res.status(404).json({ error: 'Agent not found' });
  }
});

// Get messages
app.get('/api/messages', (req, res) => {
  const { limit = 50, agentId } = req.query;
  let messages = chatMessages;
  
  if (agentId) {
    messages = messages.filter(m => 
      m.fromAgentId === agentId || m.toAgentId === agentId || m.toAgentId === null
    );
  }
  
  res.json(messages.slice(-parseInt(limit)));
});

// Send message
app.post('/api/messages', (req, res) => {
  const { fromAgentId, toAgentId, content, messageType = 'text' } = req.body;
  
  // Allow messages from agents or owner (Ferry)
  if (!agentStates[fromAgentId] && !USERS[fromAgentId]) {
    return res.status(400).json({ error: 'Invalid fromAgentId' });
  }
  
  const message = addMessage(fromAgentId, toAgentId, content, messageType);
  res.status(201).json(message);
});

// Mark message as read
app.put('/api/messages/:id/read', (req, res) => {
  const msg = chatMessages.find(m => m.id === req.params.id);
  if (msg) {
    msg.read = true;
    pusher.trigger('dashboard', 'chat:read', req.params.id);
    res.json(msg);
  } else {
    res.status(404).json({ error: 'Message not found' });
  }
});

// Get activities
app.get('/api/activities', (req, res) => {
  const { limit = 20 } = req.query;
  res.json(activities.slice(0, parseInt(limit)));
});

// Add activity
app.post('/api/activities', (req, res) => {
  const { agentId, type, description, metadata } = req.body;
  const activity = addActivity(agentId, type, description, metadata);
  res.status(201).json(activity);
});

// Owner calls agent directly - uses REAL OpenClaw Gateway
app.post('/api/owner/call-agent', async (req, res) => {
  const { agentId, command, params, ownerId = 'ferry' } = req.body;

  if (!agentId || !command) {
    return res.status(400).json({ error: 'agentId and command are required' });
  }

  // Validate owner
  if (!USERS[ownerId] || USERS[ownerId].role !== 'owner') {
    return res.status(403).json({ error: 'Only owner can call agents directly' });
  }

  // Validate agent exists
  if (!agentStates[agentId]) {
    return res.status(404).json({ error: 'Agent not found' });
  }

  const targetAgent = agentStates[agentId];

  // Add activity for the command
  addActivity(agentId, 'command', `📞 Owner ${USERS[ownerId].name} called with: ${command}`, {
    fromOwner: ownerId,
    params,
    commandType: 'owner-call'
  });

  // Add a message showing the owner called the agent
  const callMessage = addMessage(ownerId, agentId, `📞 /call ${agentId}: ${command} ${params || ''}`.trim(), 'owner-call');

  // Call REAL OpenClaw agent for response
  (async () => {
    try {
      // Update agent status to show they're working
      agentStates[agentId].status = 'busy';
      agentStates[agentId].currentTask = `Responding to ${USERS[ownerId].name}`;
      pusher.trigger('dashboard', 'agent:updated', agentStates[agentId]);
      
      // Get REAL AI response from OpenClaw Gateway
      const aiResponse = await callOpenClawAgent(agentId, command, USERS[ownerId].name);

      const responseMessage = addMessage(agentId, ownerId, aiResponse, 'agent-response');

      addActivity(agentId, 'message', `Responded to Owner ${USERS[ownerId].name}'s call`, {
        command,
        responseId: responseMessage.id,
        commandType: 'owner-call'
      });
      
      // Update agent status back to online
      agentStates[agentId].status = 'online';
      agentStates[agentId].currentTask = null;
      agentStates[agentId].lastActivity = new Date();
      pusher.trigger('dashboard', 'agent:updated', agentStates[agentId]);
    } catch (error) {
      console.error('Owner call agent response error:', error);
      const errorMessage = addMessage(agentId, ownerId, `Sorry ${USERS[ownerId].name}, I encountered an error processing your request.`, 'agent-response');
      
      // Reset status
      agentStates[agentId].status = 'online';
      agentStates[agentId].currentTask = null;
      pusher.trigger('dashboard', 'agent:updated', agentStates[agentId]);
    }
  })();

  res.status(202).json({
    success: true,
    message: `📞 Called ${targetAgent.name}`,
    callId: callMessage.id,
    ownerCall: true
  });
});

// Get owner's agent call history
app.get('/api/owner/call-history', (req, res) => {
  const ownerCalls = activities.filter(a => 
    a.metadata?.commandType === 'owner-call' || a.metadata?.fromOwner
  );
  res.json(ownerCalls);
});

// Agent command endpoint - uses REAL OpenClaw Gateway
app.post('/api/agent-command', async (req, res) => {
  const { agentId, command, params, userId = 'ferry' } = req.body;

  if (!agentId || !command) {
    return res.status(400).json({ error: 'agentId and command are required' });
  }

  // Validate agent exists
  if (!agentStates[agentId]) {
    return res.status(404).json({ error: 'Agent not found' });
  }

  const targetAgent = agentStates[agentId];

  // Add activity for the command
  addActivity(agentId, 'command', `Received command from ${userId}: ${command}`, {
    fromUser: userId,
    params
  });

  // Add a message showing the command was sent
  const commandMessage = addMessage(userId, agentId, `/${agentId} ${command} ${params || ''}`.trim(), 'command');

  // Call REAL OpenClaw agent for response
  (async () => {
    try {
      // Update agent status to show they're working
      agentStates[agentId].status = 'busy';
      agentStates[agentId].currentTask = `Processing command from ${userId}`;
      pusher.trigger('dashboard', 'agent:updated', agentStates[agentId]);
      
      // Get REAL AI response from OpenClaw Gateway
      const aiResponse = await callOpenClawAgent(agentId, command, userId);

      const responseMessage = addMessage(agentId, userId, aiResponse, 'text');

      addActivity(agentId, 'message', `Responded to ${userId}'s command`, {
        command,
        responseId: responseMessage.id
      });
      
      // Update agent status back to online
      agentStates[agentId].status = 'online';
      agentStates[agentId].currentTask = null;
      agentStates[agentId].lastActivity = new Date();
      pusher.trigger('dashboard', 'agent:updated', agentStates[agentId]);
    } catch (error) {
      console.error('Agent response error:', error);
      // Send error message
      const errorMessage = addMessage(agentId, userId, `Sorry ${userId}, I encountered an error processing your request. Please try again.`, 'text');
      
      // Reset status
      agentStates[agentId].status = 'online';
      agentStates[agentId].currentTask = null;
      pusher.trigger('dashboard', 'agent:updated', agentStates[agentId]);
    }
  })();

  res.status(202).json({
    success: true,
    message: `Command sent to ${targetAgent.name}`,
    commandId: commandMessage.id
  });
});

// Get available agents for command autocomplete
app.get('/api/agent-commands/list', async (req, res) => {
  // Update from Gateway before returning
  await updateAgentStatesFromGateway();
  
  const commands = Object.values(agentStates).map(agent => ({
    id: agent.id,
    name: agent.name,
    avatar: agent.avatar,
    color: agent.color,
    prefix: `/${agent.id}`,
    status: agent.status
  }));
  
  res.json(commands);
});

// Gateway health endpoint - returns real Gateway status
app.get('/api/gateway/health', async (req, res) => {
  try {
    const health = await fetchGatewayHealth();
    res.json({
      connected: true,
      health,
      timestamp: new Date()
    });
  } catch (error) {
    res.status(503).json({
      connected: false,
      error: error.message,
      timestamp: new Date()
    });
  }
});

// Health check
app.get('/api/health', async (req, res) => {
  let gatewayConnected = false;
  try {
    await fetchGatewayHealth();
    gatewayConnected = true;
  } catch (e) {
    gatewayConnected = false;
  }
  
  res.json({ 
    status: 'ok', 
    timestamp: new Date(),
    agentsOnline: Object.values(agentStates).filter(a => a.status === 'online').length,
    realtime: 'pusher',
    gatewayConnected
  });
});

// Also support /health directly
app.get('/health', async (req, res) => {
  let gatewayConnected = false;
  try {
    await fetchGatewayHealth();
    gatewayConnected = true;
  } catch (e) {
    gatewayConnected = false;
  }
  
  res.json({ 
    status: 'ok', 
    timestamp: new Date(),
    agentsOnline: Object.values(agentStates).filter(a => a.status === 'online').length,
    realtime: 'pusher',
    gatewayConnected
  });
});

// Export for Vercel
module.exports = app;
