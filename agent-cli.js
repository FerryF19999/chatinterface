#!/usr/bin/env node

/**
 * OpenClaw Agent CLI
 * Command-line interface untuk interaksi dengan Agent Dashboard
 * 
 * Usage:
 *   node agent-cli.js <command> [options]
 */

const io = require('socket.io-client');
const readline = require('readline');

const SERVER_URL = process.env.DASHBOARD_URL || 'http://localhost:3000';

// Agent definitions
const AGENTS = {
    yuri: { name: 'Yuri', color: '\x1b[31m', avatar: '👨‍🚀' },
    jarvis: { name: 'Jarvis', color: '\x1b[36m', avatar: '🤖' },
    friday: { name: 'Friday', color: '\x1b[34m', avatar: '👩‍💼' },
    glass: { name: 'Glass', color: '\x1b[32m', avatar: '🔍' },
    epstein: { name: 'Epstein', color: '\x1b[35m', avatar: '🧠' }
};

const RESET = '\x1b[0m';
const GRAY = '\x1b[90m';

class AgentCLI {
    constructor() {
        this.socket = null;
        this.currentAgent = null;
        this.rl = null;
    }

    showHelp() {
        console.log(`
╔═══════════════════════════════════════════════════════════╗
║          🤖 OpenClaw Agent CLI v1.0.0                     ║
╚═══════════════════════════════════════════════════════════╝

COMMANDS:

  login <agent>        Login sebagai agent (yuri/jarvis/friday/glass/epstein)
  logout               Logout dari dashboard
  
  message <text>       Kirim pesan ke channel #general
  dm <agent> <text>    Kirim direct message ke agent lain
  reply <text>         Reply ke pesan terakhir (listen mode)
  
  status <status>      Update status (online/busy/offline)
  task <description>   Update task description
  
  command <agent> <cmd> [args]  Kirim perintah ke agent lain
  
  listen               Mode listen - terima pesan & perintah realtime
  interactive          Mode interaktif dengan prompt
  
  whoami               Tampilkan agent yang sedang login
  agents               List semua agent dan statusnya
  
  help                 Tampilkan help ini

EXAMPLES:

  node agent-cli.js login friday
  node agent-cli.js message "Hello team!"
  node agent-cli.js dm jarvis "Can you analyze this file?"
  node agent-cli.js status busy
  node agent-cli.js task "Processing data export"
  node agent-cli.js command jarvis analyze --target=data.csv
  node agent-cli.js listen

ENVIRONMENT:

  DASHBOARD_URL        URL dashboard server (default: http://localhost:3000)

        `);
    }

    async connect() {
        return new Promise((resolve, reject) => {
            this.socket = io(SERVER_URL);
            
            this.socket.on('connect', () => {
                resolve();
            });
            
            this.socket.on('connect_error', (err) => {
                reject(new Error(`Cannot connect to ${SERVER_URL}: ${err.message}`));
            });
            
            setTimeout(() => {
                reject(new Error('Connection timeout'));
            }, 5000);
        });
    }

    disconnect() {
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }
    }

    async login(agentId) {
        if (!AGENTS[agentId]) {
            console.error(`❌ Unknown agent: ${agentId}`);
            console.log('Available agents:', Object.keys(AGENTS).join(', '));
            process.exit(1);
        }

        try {
            await this.connect();
            this.currentAgent = agentId;
            this.socket.emit('agent:login', agentId);
            
            const agent = AGENTS[agentId];
            console.log(`${agent.color}${agent.avatar} Logged in as ${agent.name}${RESET}`);
            
            // Save to temp file for session
            require('fs').writeFileSync('/tmp/openclaw-agent', agentId);
            
        } catch (err) {
            console.error(`❌ ${err.message}`);
            process.exit(1);
        }
    }

    async logout() {
        const agentId = this.getSavedAgent();
        if (!agentId) {
            console.error('❌ No agent logged in');
            process.exit(1);
        }

        try {
            await this.connect();
            this.socket.emit('agent:logout', agentId);
            console.log(`👋 ${AGENTS[agentId].name} logged out`);
            
            try {
                require('fs').unlinkSync('/tmp/openclaw-agent');
            } catch (e) {}
            
        } catch (err) {
            console.error(`❌ ${err.message}`);
        }
        
        this.disconnect();
    }

    getSavedAgent() {
        try {
            return require('fs').readFileSync('/tmp/openclaw-agent', 'utf8').trim();
        } catch (e) {
            return null;
        }
    }

    async sendMessage(content, toAgentId = null) {
        const agentId = this.currentAgent || this.getSavedAgent();
        if (!agentId) {
            console.error('❌ Please login first: node agent-cli.js login <agent>');
            process.exit(1);
        }

        try {
            await this.connect();
            
            this.socket.emit('chat:message', {
                fromAgentId: agentId,
                toAgentId,
                content,
                messageType: 'text'
            });
            
            const target = toAgentId ? `DM to ${AGENTS[toAgentId]?.name || toAgentId}` : '#general';
            console.log(`${GRAY}✓ Message sent to ${target}${RESET}`);
            
            // Give time for message to send
            setTimeout(() => this.disconnect(), 500);
            
        } catch (err) {
            console.error(`❌ ${err.message}`);
            process.exit(1);
        }
    }

    async updateStatus(status, task = null) {
        const agentId = this.currentAgent || this.getSavedAgent();
        if (!agentId) {
            console.error('❌ Please login first');
            process.exit(1);
        }

        try {
            await this.connect();
            
            this.socket.emit('agent:status', {
                agentId,
                status,
                task
            });
            
            console.log(`${GRAY}✓ Status updated: ${status}${task ? ` | Task: ${task}` : ''}${RESET}`);
            
            setTimeout(() => this.disconnect(), 500);
            
        } catch (err) {
            console.error(`❌ ${err.message}`);
        }
    }

    async sendCommand(toAgentId, command, params = {}) {
        const agentId = this.currentAgent || this.getSavedAgent();
        if (!agentId) {
            console.error('❌ Please login first');
            process.exit(1);
        }

        try {
            await this.connect();
            
            this.socket.emit('agent:command', {
                fromAgentId: agentId,
                toAgentId,
                command,
                params
            });
            
            console.log(`${GRAY}✓ Command sent to ${AGENTS[toAgentId]?.name || toAgentId}: ${command}${RESET}`);
            
            setTimeout(() => this.disconnect(), 500);
            
        } catch (err) {
            console.error(`❌ ${err.message}`);
        }
    }

    async listen() {
        const agentId = this.currentAgent || this.getSavedAgent();
        if (!agentId) {
            console.error('❌ Please login first');
            process.exit(1);
        }

        try {
            await this.connect();
            this.socket.emit('agent:login', agentId);
            
            const agent = AGENTS[agentId];
            console.log(`${agent.color}${agent.avatar} ${agent.name} is listening...${RESET}`);
            console.log(`${GRAY}Press Ctrl+C to exit${RESET}\n`);
            
            // Handle incoming messages
            this.socket.on('chat:message', (msg) => {
                const from = AGENTS[msg.fromAgentId];
                const isDM = msg.toAgentId === agentId;
                const isBroadcast = !msg.toAgentId;
                
                if (msg.fromAgentId === agentId) return; // Skip own messages
                
                if (isDM || isBroadcast) {
                    const prefix = isDM ? '[DM]' : '[#general]';
                    const color = from?.color || GRAY;
                    console.log(`${color}${prefix} ${from?.avatar || '👤'} ${from?.name || msg.fromAgentId}: ${RESET}${msg.content}`);
                }
            });
            
            // Handle direct commands
            this.socket.on('agent:command', (cmd) => {
                const from = AGENTS[cmd.fromAgentId];
                const color = from?.color || GRAY;
                console.log(`\n${color}[COMMAND] ${from?.avatar || '👤'} ${from?.name || cmd.fromAgentId}:${RESET}`);
                console.log(`  Command: ${cmd.command}`);
                console.log(`  Params:`, cmd.params);
                console.log(`  Time: ${new Date(cmd.timestamp).toLocaleTimeString()}`);
                console.log();
            });
            
            // Handle activity
            this.socket.on('activity:new', (activity) => {
                const actor = AGENTS[activity.agentId];
                console.log(`${GRAY}[ACTIVITY] ${actor?.name || activity.agentId}: ${activity.description}${RESET}`);
            });
            
            // Keep alive
            process.stdin.resume();
            
        } catch (err) {
            console.error(`❌ ${err.message}`);
            process.exit(1);
        }
    }

    async interactive() {
        const agentId = this.currentAgent || this.getSavedAgent();
        if (!agentId) {
            console.error('❌ Please login first');
            process.exit(1);
        }

        await this.connect();
        this.socket.emit('agent:login', agentId);
        
        const agent = AGENTS[agentId];
        console.log(`${agent.color}${agent.avatar} ${agent.name} Interactive Mode${RESET}`);
        console.log(`${GRAY}Type 'help' for commands, 'exit' to quit${RESET}\n`);
        
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        
        // Set up socket listeners
        this.socket.on('chat:message', (msg) => {
            if (msg.fromAgentId !== agentId) {
                const from = AGENTS[msg.fromAgentId];
                console.log(`\n${from?.color || GRAY}${from?.avatar || '👤'} ${from?.name || msg.fromAgentId}:${RESET} ${msg.content}`);
                this.rl.prompt();
            }
        });
        
        const prompt = () => {
            this.rl.question(`${agent.color}${agent.name}> ${RESET}`, (input) => {
                const args = input.trim().split(' ');
                const cmd = args[0].toLowerCase();
                
                switch (cmd) {
                    case 'exit':
                    case 'quit':
                        console.log('Goodbye!');
                        this.rl.close();
                        this.disconnect();
                        process.exit(0);
                        break;
                        
                    case 'help':
                        console.log(`
Commands:
  msg <text>        Send message to #general
  dm <agent> <text> Send direct message
  status <s>        Set status (online/busy/offline)
  task <desc>       Set current task
  cmd <agent> <c>   Send command to agent
  whoami            Show current agent
  clear             Clear screen
  exit              Exit interactive mode
                        `);
                        prompt();
                        break;
                        
                    case 'msg':
                    case 'message':
                        const msgText = args.slice(1).join(' ');
                        if (msgText) {
                            this.socket.emit('chat:message', {
                                fromAgentId: agentId,
                                toAgentId: null,
                                content: msgText,
                                messageType: 'text'
                            });
                        }
                        prompt();
                        break;
                        
                    case 'dm':
                        const targetAgent = args[1];
                        const dmText = args.slice(2).join(' ');
                        if (targetAgent && dmText) {
                            this.socket.emit('chat:message', {
                                fromAgentId: agentId,
                                toAgentId: targetAgent,
                                content: dmText,
                                messageType: 'text'
                            });
                        }
                        prompt();
                        break;
                        
                    case 'status':
                        if (args[1]) {
                            this.socket.emit('agent:status', {
                                agentId,
                                status: args[1],
                                task: null
                            });
                        }
                        prompt();
                        break;
                        
                    case 'task':
                        const taskDesc = args.slice(1).join(' ');
                        this.socket.emit('agent:status', {
                            agentId,
                            status: 'busy',
                            task: taskDesc
                        });
                        prompt();
                        break;
                        
                    case 'cmd':
                    case 'command':
                        const cmdTarget = args[1];
                        const cmdName = args[2];
                        if (cmdTarget && cmdName) {
                            this.socket.emit('agent:command', {
                                fromAgentId: agentId,
                                toAgentId: cmdTarget,
                                command: cmdName,
                                params: args.slice(3)
                            });
                        }
                        prompt();
                        break;
                        
                    case 'whoami':
                        console.log(`Logged in as: ${agent.name} (${agentId})`);
                        prompt();
                        break;
                        
                    case 'clear':
                        console.clear();
                        prompt();
                        break;
                        
                    default:
                        if (input.trim()) {
                            // Default to sending message
                            this.socket.emit('chat:message', {
                                fromAgentId: agentId,
                                toAgentId: null,
                                content: input,
                                messageType: 'text'
                            });
                        }
                        prompt();
                }
            });
        };
        
        prompt();
    }

    async listAgents() {
        try {
            const response = await fetch(`${SERVER_URL}/api/agents`);
            const agents = await response.json();
            
            console.log('\n📊 Agent Status:\n');
            agents.forEach(agent => {
                const statusColor = agent.status === 'online' ? '\x1b[32m' : 
                                   agent.status === 'busy' ? '\x1b[33m' : '\x1b[90m';
                const agentInfo = AGENTS[agent.id];
                console.log(`  ${agentInfo?.avatar || '👤'} ${agentInfo?.color || ''}${agent.name}${RESET} - ${statusColor}${agent.status}${RESET}`);
                if (agent.currentTask) {
                    console.log(`     ${GRAY}Task: ${agent.currentTask}${RESET}`);
                }
            });
            console.log();
            
        } catch (err) {
            console.error(`❌ Cannot fetch agents: ${err.message}`);
        }
    }

    whoami() {
        const agentId = this.getSavedAgent();
        if (agentId) {
            const agent = AGENTS[agentId];
            console.log(`${agent.color}${agent.avatar} ${agent.name} (${agentId})${RESET}`);
        } else {
            console.log('No agent logged in');
        }
    }
}

// Main CLI handler
async function main() {
    const cli = new AgentCLI();
    const args = process.argv.slice(2);
    const command = args[0];
    
    if (!command || command === 'help' || command === '-h' || command === '--help') {
        cli.showHelp();
        return;
    }
    
    switch (command) {
        case 'login':
            await cli.login(args[1]);
            setTimeout(() => cli.disconnect(), 500);
            break;
            
        case 'logout':
            await cli.logout();
            break;
            
        case 'msg':
        case 'message':
            await cli.sendMessage(args.slice(1).join(' '));
            break;
            
        case 'dm':
            const targetAgent = args[1];
            const dmContent = args.slice(2).join(' ');
            if (!targetAgent || !dmContent) {
                console.error('Usage: node agent-cli.js dm <agent> <message>');
                process.exit(1);
            }
            await cli.sendMessage(dmContent, targetAgent);
            break;
            
        case 'status':
            await cli.updateStatus(args[1], args.slice(2).join(' ') || null);
            break;
            
        case 'task':
            await cli.updateStatus('busy', args.slice(1).join(' '));
            break;
            
        case 'cmd':
        case 'command':
            const cmdTarget = args[1];
            const cmdName = args[2];
            if (!cmdTarget || !cmdName) {
                console.error('Usage: node agent-cli.js command <agent> <command> [args...]');
                process.exit(1);
            }
            // Parse args like --key=value
            const cmdArgs = args.slice(3);
            const params = {};
            cmdArgs.forEach(arg => {
                if (arg.startsWith('--')) {
                    const [key, value] = arg.slice(2).split('=');
                    params[key] = value || true;
                }
            });
            await cli.sendCommand(cmdTarget, cmdName, params);
            break;
            
        case 'listen':
            await cli.listen();
            break;
            
        case 'interactive':
        case 'i':
            await cli.interactive();
            break;
            
        case 'agents':
            await cli.listAgents();
            break;
            
        case 'whoami':
            cli.whoami();
            break;
            
        default:
            console.error(`❌ Unknown command: ${command}`);
            console.log('Run `node agent-cli.js help` for usage');
            process.exit(1);
    }
}

main().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
});