// Vercel Serverless API Handler with Pusher Real-time
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const Pusher = require('pusher');

// Initialize Pusher
const pusher = new Pusher({
  appId: process.env.PUSHER_APP_ID || 'your-app-id',
  key: process.env.PUSHER_KEY || 'your-key',
  secret: process.env.PUSHER_SECRET || 'your-secret',
  cluster: process.env.PUSHER_CLUSTER || 'ap1',
  useTLS: true
});

const app = express();
app.use(express.json());

// In-memory state (note: Vercel serverless is stateless, use external DB for production)
const AGENTS = [
  { id: 'yuri', name: 'Yuri', color: '#FF6B6B', avatar: '👨‍🚀', status: 'offline', lastActivity: null, currentTask: null, role: 'agent' },
  { id: 'jarvis', name: 'Jarvis', color: '#4ECDC4', avatar: '🤖', status: 'offline', lastActivity: null, currentTask: null, role: 'agent' },
  { id: 'friday', name: 'Friday', color: '#45B7D1', avatar: '👩‍💼', status: 'offline', lastActivity: null, currentTask: null, role: 'agent' },
  { id: 'glass', name: 'Glass', color: '#96CEB4', avatar: '🔍', status: 'offline', lastActivity: null, currentTask: null, role: 'agent' },
  { id: 'epstein', name: 'Epstein', color: '#DDA0DD', avatar: '🧠', status: 'offline', lastActivity: null, currentTask: null, role: 'agent' }
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

// Helper to get sender info (agent or user)
function getSenderInfo(senderId) {
  if (USERS[senderId]) return USERS[senderId];
  return agentStates[senderId];
}

let chatMessages = [];
let activities = [];

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

// Agent personalities and system prompts
const AGENT_PERSONALITIES = {
  jarvis: {
    name: 'Jarvis',
    personality: 'You are Jarvis, an efficient and professional AI assistant. You are helpful, concise, and focused on productivity. You speak in a formal but friendly manner. You excel at task management, automation, and technical assistance.',
    tone: 'professional and efficient'
  },
  friday: {
    name: 'Friday',
    personality: 'You are Friday, an executive assistant agent. You are organized, detail-oriented, and proactive. You help with scheduling, research, documentation, and general executive tasks. You speak in a warm, professional manner.',
    tone: 'warm and organized'
  },
  glass: {
    name: 'Glass',
    personality: 'You are Glass, a research and analytics specialist. You are analytical, precise, and thorough. You excel at data analysis, research, investigation, and finding patterns. You speak clearly and factually.',
    tone: 'analytical and precise'
  },
  epstein: {
    name: 'Epstein',
    personality: 'You are Epstein, a knowledgeable advisor and intellectual. You enjoy deep discussions, knowledge sharing, and complex problem solving. You are thoughtful, well-read, and enjoy philosophical and intellectual conversations.',
    tone: 'thoughtful and intellectual'
  },
  yuri: {
    name: 'Yuri',
    personality: 'You are Yuri, a space and exploration specialist with an adventurous spirit. You are bold, enthusiastic, and ready for challenges. You speak with energy and are always ready to take on missions.',
    tone: 'enthusiastic and bold'
  }
};

// Call Anthropic API for agent response
async function callAgentAI(agentId, userMessage, userId = 'ferry') {
  const agent = AGENT_PERSONALITIES[agentId];
  if (!agent) {
    throw new Error(`Unknown agent: ${agentId}`);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY not configured');
  }

  const systemPrompt = `${agent.personality}

You are responding to ${userId}. Keep your response concise (2-4 sentences) and in character. Be helpful and engaging.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 500,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }]
      })
    });

    if (!response.ok) {
      throw new Error(`Anthropic API error: ${response.status}`);
    }

    const data = await response.json();
    return data.content[0].text;
  } catch (error) {
    console.error('AI call failed:', error);
    // Fallback response if AI fails
    return `Hello ${userId}! I'm ${agent.name}. I received your message: "${userMessage}". How can I assist you further?`;
  }
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
app.get('/api/init', (req, res) => {
  res.json({
    agents: Object.values(agentStates),
    users: USERS,
    messages: chatMessages.slice(-50),
    activities: activities.slice(-20),
    pusherKey: process.env.PUSHER_KEY || 'your-key',
    pusherCluster: process.env.PUSHER_CLUSTER || 'ap1'
  });
});

// Agent login
app.post('/api/agents/:id/login', (req, res) => {
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

// Get all agents
app.get('/api/agents', (req, res) => {
  res.json(Object.values(agentStates));
});

// Get single agent
app.get('/api/agents/:id', (req, res) => {
  const agent = agentStates[req.params.id];
  if (agent) {
    res.json(agent);
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

// Owner calls agent directly - Ferry can invoke any agent
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

  // Call actual AI agent for response
  (async () => {
    try {
      const aiResponse = await callAgentAI(agentId, command, USERS[ownerId].name);

      const responseMessage = addMessage(agentId, ownerId, aiResponse, 'agent-response');

      addActivity(agentId, 'message', `Responded to Owner ${USERS[ownerId].name}'s call`, {
        command,
        responseId: responseMessage.id,
        commandType: 'owner-call'
      });
    } catch (error) {
      console.error('Owner call agent response error:', error);
      const errorMessage = addMessage(agentId, ownerId, `Sorry ${USERS[ownerId].name}, I encountered an error processing your request.`, 'agent-response');
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

// Agent command endpoint - allows users to call agents via /agentname command
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

  // Call actual AI agent for response
  (async () => {
    try {
      // Get AI response
      const aiResponse = await callAgentAI(agentId, command, userId);

      const responseMessage = addMessage(agentId, userId, aiResponse, 'text');

      addActivity(agentId, 'message', `Responded to ${userId}'s command`, {
        command,
        responseId: responseMessage.id
      });
    } catch (error) {
      console.error('Agent response error:', error);
      // Send error message
      const errorMessage = addMessage(agentId, userId, `Sorry ${userId}, I encountered an error processing your request. Please try again.`, 'text');
    }
  })();

  res.status(202).json({
    success: true,
    message: `Command sent to ${targetAgent.name}`,
    commandId: commandMessage.id
  });
});

// Get available agents for command autocomplete
app.get('/api/agent-commands/list', (req, res) => {
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

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date(),
    agentsOnline: Object.values(agentStates).filter(a => a.status === 'online').length,
    realtime: 'pusher'
  });
});

// Also support /health directly
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date(),
    agentsOnline: Object.values(agentStates).filter(a => a.status === 'online').length,
    realtime: 'pusher'
  });
});

// Export for Vercel
module.exports = app;
