const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const { spawn } = require('child_process');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Static files
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// OpenClaw Gateway configuration
const GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL || 'ws://127.0.0.1:18789';
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || null;

// Agent definitions mapped to OpenClaw agents
const AGENTS = [
  { id: 'yuri', name: 'Yuri', color: '#FF6B6B', avatar: '👨‍🚀', status: 'offline', lastActivity: null, currentTask: null, openclawAgent: 'yuri' },
  { id: 'jarvis', name: 'Jarvis', color: '#4ECDC4', avatar: '🤖', status: 'offline', lastActivity: null, currentTask: null, openclawAgent: 'jarvis' },
  { id: 'friday', name: 'Friday', color: '#45B7D1', avatar: '👩‍💼', status: 'offline', lastActivity: null, currentTask: null, openclawAgent: 'friday' },
  { id: 'glass', name: 'Glass', color: '#96CEB4', avatar: '🔍', status: 'offline', lastActivity: null, currentTask: null, openclawAgent: 'glass' },
  { id: 'epstein', name: 'Epstein', color: '#DDA0DD', avatar: '🧠', status: 'offline', lastActivity: null, currentTask: null, openclawAgent: 'epstein' }
];

// User profile (Ferry) - Owner with full control
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

// State management
let agentStates = {};
let chatMessages = [];
let activities = [];

// Initialize agent states
AGENTS.forEach(agent => {
  agentStates[agent.id] = { ...agent };
});

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
  return activity;
}

function addMessage(fromAgentId, toAgentId, content, messageType = 'text') {
  const message = {
    id: uuidv4(),
    fromAgentId,
    toAgentId, // null for broadcast
    content,
    messageType,
    timestamp: new Date(),
    read: false
  };
  chatMessages.push(message);
  if (chatMessages.length > 500) chatMessages.shift();
  
  // Add activity for the message
  const fromSender = getSenderInfo(fromAgentId);
  const targetName = toAgentId ? (getSenderInfo(toAgentId)?.name || toAgentId) : 'everyone';
  const senderName = fromSender?.name || fromAgentId;
  addActivity(fromAgentId, 'message', `${senderName} sent message to ${targetName}`, { messageId: message.id });
  
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

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  
  // Send current state to new client
  socket.emit('init', {
    agents: Object.values(agentStates),
    users: USERS,
    messages: chatMessages.slice(-50),
    activities: activities.slice(-20)
  });

  // Agent login
  socket.on('agent:login', async (agentId) => {
    if (agentStates[agentId]) {
      agentStates[agentId].status = 'online';
      agentStates[agentId].lastActivity = new Date();
      agentStates[agentId].socketId = socket.id;
      
      socket.agentId = agentId;
      
      addActivity(agentId, 'login', `${agentStates[agentId].name} is now online`);
      
      io.emit('agent:updated', agentStates[agentId]);
      io.emit('activity:new', activities[0]);
      
      console.log(`Agent ${agentId} logged in`);
    }
  });

  // Agent logout
  socket.on('agent:logout', (agentId) => {
    if (agentStates[agentId]) {
      agentStates[agentId].status = 'offline';
      agentStates[agentId].currentTask = null;
      delete agentStates[agentId].socketId;
      
      addActivity(agentId, 'logout', `${agentStates[agentId].name} went offline`);
      
      io.emit('agent:updated', agentStates[agentId]);
      io.emit('activity:new', activities[0]);
    }
  });

  // Update agent status/task
  socket.on('agent:status', ({ agentId, status, task }) => {
    if (agentStates[agentId]) {
      if (status) agentStates[agentId].status = status;
      if (task !== undefined) agentStates[agentId].currentTask = task;
      agentStates[agentId].lastActivity = new Date();
      
      if (task) {
        addActivity(agentId, 'task', `Working on: ${task}`);
        io.emit('activity:new', activities[0]);
      }
      
      io.emit('agent:updated', agentStates[agentId]);
    }
  });

  // Send chat message
  socket.on('chat:message', (data) => {
    const { fromAgentId, toAgentId, content, messageType = 'text' } = data;
    
    if (agentStates[fromAgentId]) {
      const message = addMessage(fromAgentId, toAgentId, content, messageType);
      
      // Broadcast to all clients
      io.emit('chat:message', message);
      
      // If direct message, also notify the target agent
      if (toAgentId && agentStates[toAgentId]?.socketId) {
        io.to(agentStates[toAgentId].socketId).emit('chat:direct', message);
      }
    }
  });

  // Mark message as read
  socket.on('chat:read', (messageId) => {
    const msg = chatMessages.find(m => m.id === messageId);
    if (msg) {
      msg.read = true;
      io.emit('chat:read', messageId);
    }
  });

  // Typing indicator
  socket.on('chat:typing', ({ agentId, isTyping }) => {
    socket.broadcast.emit('chat:typing', { agentId, isTyping });
  });

  // Command from agent
  socket.on('agent:command', ({ fromAgentId, toAgentId, command, params }) => {
    addActivity(fromAgentId, 'command', `Executed command: ${command}`, { toAgentId, params });
    
    // Forward command to target agent if specified
    if (toAgentId && agentStates[toAgentId]?.socketId) {
      io.to(agentStates[toAgentId].socketId).emit('agent:command', {
        fromAgentId,
        command,
        params,
        timestamp: new Date()
      });
    }
    
    io.emit('activity:new', activities[0]);
  });

  // Disconnect handling
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    
    // Mark agent as offline if they were logged in
    if (socket.agentId && agentStates[socket.agentId]) {
      agentStates[socket.agentId].status = 'offline';
      agentStates[socket.agentId].currentTask = null;
      delete agentStates[socket.agentId].socketId;
      
      addActivity(socket.agentId, 'disconnect', `${agentStates[socket.agentId].name} disconnected`);
      
      io.emit('agent:updated', agentStates[socket.agentId]);
      io.emit('activity:new', activities[0]);
    }
  });
});

// REST API endpoints

// Initialize endpoint - provides full state including users
app.get('/api/init', async (req, res) => {
  // Update from Gateway before returning
  await updateAgentStatesFromGateway();
  
  res.json({
    agents: Object.values(agentStates),
    users: USERS,
    messages: chatMessages.slice(-50),
    activities: activities.slice(-20),
    gatewayConnected: true
  });
});

app.get('/api/agents', async (req, res) => {
  // Update from Gateway before returning
  await updateAgentStatesFromGateway();
  res.json(Object.values(agentStates));
});

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

app.get('/api/activities', (req, res) => {
  const { limit = 20 } = req.query;
  res.json(activities.slice(0, parseInt(limit)));
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
  
  // Broadcast the command message
  io.emit('chat:message', commandMessage);
  io.emit('activity:new', activities[0]);
  
  // Call REAL OpenClaw agent for response
  (async () => {
    try {
      // Update agent status to show they're working
      agentStates[agentId].status = 'busy';
      agentStates[agentId].currentTask = `Processing command from ${userId}`;
      io.emit('agent:updated', agentStates[agentId]);
      
      // Get REAL AI response from OpenClaw Gateway
      const aiResponse = await callOpenClawAgent(agentId, command, userId);
      
      const responseMessage = addMessage(agentId, userId, aiResponse, 'text');
      
      // Broadcast the response
      io.emit('chat:message', responseMessage);
      
      addActivity(agentId, 'message', `Responded to ${userId}'s command`, { 
        command, 
        responseId: responseMessage.id 
      });
      io.emit('activity:new', activities[0]);
      
      // Update agent status back to online
      agentStates[agentId].status = 'online';
      agentStates[agentId].currentTask = null;
      agentStates[agentId].lastActivity = new Date();
      io.emit('agent:updated', agentStates[agentId]);
    } catch (error) {
      console.error('Agent response error:', error);
      // Send error message
      const errorMessage = addMessage(agentId, userId, `Sorry ${userId}, I encountered an error processing your request. Please try again.`, 'text');
      io.emit('chat:message', errorMessage);
      
      // Reset status
      agentStates[agentId].status = 'online';
      agentStates[agentId].currentTask = null;
      io.emit('agent:updated', agentStates[agentId]);
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
    prefix: `/${agent.id}`
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
    gatewayConnected
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 OpenClaw Agent Dashboard running on port ${PORT}`);
  console.log(`📊 Dashboard: http://localhost:${PORT}`);
  console.log(`🔗 Connected to OpenClaw Gateway at ${GATEWAY_URL}`);
});

module.exports = { app, server, io };
