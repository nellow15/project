import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ITerminalOptions, Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { SearchAddon } from 'xterm-addon-search';
import { SearchBarAddon } from 'xterm-addon-search-bar';
import { WebLinksAddon } from 'xterm-addon-web-links';
import { ScrollDownHelperAddon } from '@/plugins/XtermScrollDownHelperAddon';
import SpinnerOverlay from '@/components/elements/SpinnerOverlay';
import { ServerContext } from '@/state/server';
import { usePermissions } from '@/plugins/usePermissions';
import { theme as th } from 'twin.macro';
import useEventListener from '@/plugins/useEventListener';
import { debounce } from 'debounce';
import { usePersistedState } from '@/plugins/usePersistedState';
import { SocketEvent, SocketRequest } from '@/components/server/events';
import classNames from 'classnames';
import { 
  ChevronDoubleRightIcon, 
  TerminalIcon,
  SearchIcon,
  ClipboardCopyIcon,
  RefreshIcon,
  StatusOnlineIcon,
  StatusOfflineIcon 
} from '@heroicons/react/solid';

import 'xterm/css/xterm.css';
import styles from './style.module.css';

// Modern Terminal Theme dengan skema biru-cyan
const theme = {
  background: 'rgba(10, 25, 47, 0.95)',
  foreground: '#e6f1ff',
  cursor: '#64ffda',
  cursorAccent: '#0a192f',
  selection: 'rgba(100, 255, 218, 0.3)',
  black: '#011627',
  red: '#ff6c6b',
  green: '#98be65',
  yellow: '#ecbe7b',
  blue: '#51afef',
  magenta: '#c678dd',
  cyan: '#46d9ff',
  white: '#dfdfdf',
  brightBlack: 'rgba(255, 255, 255, 0.2)',
  brightRed: '#ff6c6b',
  brightGreen: '#c3e88d',
  brightYellow: '#ffcb6b',
  brightBlue: '#82aaff',
  brightMagenta: '#c792ea',
  brightCyan: '#89ddff',
  brightWhite: '#ffffff',
};

const terminalProps: ITerminalOptions = {
  disableStdin: true,
  cursorStyle: 'block',
  cursorBlink: true,
  allowTransparency: true,
  fontSize: 13,
  fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, Monaco, 'Courier New', monospace",
  lineHeight: 1.3,
  letterSpacing: 0.3,
  rows: 35,
  theme: theme,
  scrollback: 5000,
  windowsMode: false,
};

export default () => {
  const TERMINAL_PRELUDE = '\u001b[1m\u001b[38;2;100;255;218mcontainer@pterodactyl~\u001b[0m\u001b[1m\u001b[38;2;136;146;176m \u276F\u001b[0m ';
  const ref = useRef<HTMLDivElement>(null);
  const terminal = useMemo(() => new Terminal({ ...terminalProps }), []);
  const fitAddon = new FitAddon();
  const searchAddon = new SearchAddon();
  const searchBar = new SearchBarAddon({ searchAddon });
  const webLinksAddon = new WebLinksAddon();
  const scrollDownHelperAddon = new ScrollDownHelperAddon();
  const { connected, instance } = ServerContext.useStoreState((state) => state.socket);
  const [canSendCommands] = usePermissions(['control.console']);
  const serverId = ServerContext.useStoreState((state) => state.server.data!.id);
  const serverName = ServerContext.useStoreState((state) => state.server.data!.name);
  const isTransferring = ServerContext.useStoreState((state) => state.server.data!.isTransferring);
  const [history, setHistory] = usePersistedState<string[]>(`${serverId}:command_history`, []);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [isSearchVisible, setIsSearchVisible] = useState(false);
  const [terminalStats, setTerminalStats] = useState({ lines: 0, lastUpdate: new Date() });

  const handleConsoleOutput = (line: string, prelude = false) => {
    terminal.writeln((prelude ? TERMINAL_PRELUDE : '') + line.replace(/(?:\r\n|\r|\n)$/im, '') + '\u001b[0m');
    setTerminalStats(prev => ({ ...prev, lines: prev.lines + 1 }));
  };

  const handleTransferStatus = (status: string) => {
    const timestamp = `\u001b[90m[${new Date().toLocaleTimeString()}]\u001b[0m `;
    switch (status) {
      case 'failure':
        terminal.writeln(timestamp + TERMINAL_PRELUDE + '\u001b[31m❌ Transfer has failed.\u001b[0m');
        return;
      case 'archive':
        terminal.writeln(timestamp + TERMINAL_PRELUDE + '\u001b[36m📦 Server has been archived successfully, attempting connection to target node...\u001b[0m');
        return;
      case 'success':
        terminal.writeln(timestamp + TERMINAL_PRELUDE + '\u001b[32m✅ Transfer completed successfully.\u001b[0m');
        return;
    }
  };

  const handleDaemonErrorOutput = (line: string) => {
    const timestamp = `\u001b[90m[${new Date().toLocaleTimeString()}]\u001b[0m `;
    terminal.writeln(timestamp + TERMINAL_PRELUDE + '\u001b[1m\u001b[41m🚨 ' + line.replace(/(?:\r\n|\r|\n)$/im, '') + '\u001b[0m');
  };

  const handlePowerChangeEvent = (state: string) => {
    const timestamp = `\u001b[90m[${new Date().toLocaleTimeString()}]\u001b[0m `;
    const stateIcon = state === 'starting' ? '🚀' : state === 'running' ? '✅' : state === 'stopping' ? '⏸️' : '🛑';
    terminal.writeln(timestamp + TERMINAL_PRELUDE + `${stateIcon} Server marked as \u001b[1m${state}\u001b[0m...`);
  };

  const handleCommandKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowUp') {
      const newIndex = Math.min(historyIndex + 1, history!.length - 1);
      setHistoryIndex(newIndex);
      e.currentTarget.value = history![newIndex] || '';
      e.preventDefault();
    }

    if (e.key === 'ArrowDown') {
      const newIndex = Math.max(historyIndex - 1, -1);
      setHistoryIndex(newIndex);
      e.currentTarget.value = history![newIndex] || '';
    }

    if (e.key === 'Tab') {
      e.preventDefault();
      const current = e.currentTarget.value;
      if (current.trim()) {
        // Basic command completion (bisa diperluas)
        const completions = ['help', 'status', 'stop', 'start', 'restart', 'say', 'list'];
        const match = completions.find(cmd => cmd.startsWith(current.toLowerCase()));
        if (match) {
          e.currentTarget.value = match;
        }
      }
    }

    const command = e.currentTarget.value;
    if (e.key === 'Enter' && command.length > 0) {
      const timestamp = `\u001b[90m[${new Date().toLocaleTimeString()}]\u001b[0m `;
      terminal.writeln(timestamp + TERMINAL_PRELUDE + '\u001b[36m➜\u001b[0m ' + command);
      
      setHistory((prevHistory) => [command, ...prevHistory!].slice(0, 50));
      setHistoryIndex(-1);

      instance && instance.send('send command', command);
      e.currentTarget.value = '';
    }
  };

  const clearTerminal = () => {
    terminal.clear();
    setTerminalStats({ lines: 0, lastUpdate: new Date() });
  };

  const copyTerminalContent = async () => {
    try {
      const content = terminal.getSelection() || terminal.buffer.active.getLine(0)?.translateToString();
      if (content) {
        await navigator.clipboard.writeText(content);
        // Show temporary notification
        const notification = document.createElement('div');
        notification.className = 'absolute top-4 right-4 bg-green-500/90 text-white px-4 py-2 rounded-lg shadow-lg';
        notification.textContent = 'Copied to clipboard!';
        document.body.appendChild(notification);
        setTimeout(() => notification.remove(), 2000);
      }
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  useEffect(() => {
    if (connected && ref.current && !terminal.element) {
      terminal.loadAddon(fitAddon);
      terminal.loadAddon(searchAddon);
      terminal.loadAddon(searchBar);
      terminal.loadAddon(webLinksAddon);
      terminal.loadAddon(scrollDownHelperAddon);

      terminal.open(ref.current);
      fitAddon.fit();

      // Welcome message dengan style modern
      terminal.writeln('\u001b[1m\u001b[36m╔════════════════════════════════════════════════════════════╗\u001b[0m');
      terminal.writeln('\u001b[1m\u001b[36m║                 TERMINAL CONSOLE - READY                  ║\u001b[0m');
      terminal.writeln('\u001b[1m\u001b[36m╚════════════════════════════════════════════════════════════╝\u001b[0m');
      terminal.writeln('');
      terminal.writeln(`\u001b[32m●\u001b[0m Server: \u001b[1m${serverName}\u001b[0m`);
      terminal.writeln(`\u001b[34m●\u001b[0m Time: ${new Date().toLocaleString()}`);
      terminal.writeln(`\u001b[35m●\u001b[0m Type \u001b[33m'help'\u001b[0m for available commands`);
      terminal.writeln('');

      // Enhanced key handling
      terminal.attachCustomKeyEventHandler((e: KeyboardEvent) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
          copyTerminalContent();
          return false;
        } else if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
          e.preventDefault();
          searchBar.show();
          setIsSearchVisible(true);
          return false;
        } else if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
          e.preventDefault();
          clearTerminal();
          return false;
        } else if (e.key === 'Escape') {
          searchBar.hidden();
          setIsSearchVisible(false);
        } else if (e.key === 'F1') {
          e.preventDefault();
          terminal.writeln(TERMINAL_PRELUDE + '\u001b[33mAvailable commands: help, status, clear, say [message]\u001b[0m');
        }
        return true;
      });
    }
  }, [terminal, connected, serverName]);

  useEventListener(
    'resize',
    debounce(() => {
      if (terminal.element) {
        fitAddon.fit();
      }
    }, 100)
  );

  useEffect(() => {
    const listeners: Record<string, (s: string) => void> = {
      [SocketEvent.STATUS]: handlePowerChangeEvent,
      [SocketEvent.CONSOLE_OUTPUT]: handleConsoleOutput,
      [SocketEvent.INSTALL_OUTPUT]: handleConsoleOutput,
      [SocketEvent.TRANSFER_LOGS]: handleConsoleOutput,
      [SocketEvent.TRANSFER_STATUS]: handleTransferStatus,
      [SocketEvent.DAEMON_MESSAGE]: (line) => handleConsoleOutput(line, true),
      [SocketEvent.DAEMON_ERROR]: handleDaemonErrorOutput,
    };

    if (connected && instance) {
      if (!isTransferring) {
        terminal.clear();
        // Re-add welcome message after clear
        terminal.writeln('\u001b[36m● Terminal connected - Loading logs...\u001b[0m\n');
      }

      Object.keys(listeners).forEach((key: string) => {
        instance.addListener(key, listeners[key]);
      });
      instance.send(SocketRequest.SEND_LOGS);
      
      // Update stats periodically
      const statsInterval = setInterval(() => {
        setTerminalStats(prev => ({ ...prev, lastUpdate: new Date() }));
      }, 60000); // Update every minute

      return () => {
        clearInterval(statsInterval);
        if (instance) {
          Object.keys(listeners).forEach((key: string) => {
            instance.removeListener(key, listeners[key]);
          });
        }
      };
    }
  }, [connected, instance]);

  return (
    <div className="relative rounded-xl overflow-hidden shadow-2xl">
      {/* Background gradient effect */}
      <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/5 via-blue-900/10 to-purple-500/5 pointer-events-none" />
      
      {/* Main terminal container */}
      <div className="relative z-10">
        {/* Terminal Header */}
        <div className="glass-header bg-gradient-to-r from-cyan-900/40 via-blue-900/30 to-cyan-900/40 px-6 py-4 border-b border-cyan-500/20">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2">
                <TerminalIcon className="w-5 h-5 text-cyan-400" />
                <span className="font-mono font-semibold text-cyan-300">server-console</span>
                <div className="flex items-center space-x-1 ml-2">
                  <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
                  <span className="text-xs font-mono text-gray-400">
                    {connected ? 'LIVE' : 'OFFLINE'}
                  </span>
                </div>
              </div>
              <div className="hidden md:flex items-center space-x-4 text-sm">
                <div className="flex items-center space-x-1">
                  <span className="text-gray-500">Lines:</span>
                  <span className="font-mono text-cyan-400">{terminalStats.lines}</span>
                </div>
                <div className="flex items-center space-x-1">
                  <span className="text-gray-500">Last:</span>
                  <span className="font-mono text-gray-400">
                    {terminalStats.lastUpdate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              </div>
            </div>
            
            {/* Terminal Controls */}
            <div className="flex items-center space-x-2">
              <button
                onClick={() => {
                  searchBar.show();
                  setIsSearchVisible(true);
                }}
                className="glass-button p-2 rounded-lg hover:bg-cyan-900/30 transition-colors"
                title="Search (Ctrl+F)"
              >
                <SearchIcon className="w-4 h-4 text-gray-400 hover:text-cyan-300" />
              </button>
              <button
                onClick={copyTerminalContent}
                className="glass-button p-2 rounded-lg hover:bg-cyan-900/30 transition-colors"
                title="Copy Selection (Ctrl+C)"
              >
                <ClipboardCopyIcon className="w-4 h-4 text-gray-400 hover:text-green-300" />
              </button>
              <button
                onClick={clearTerminal}
                className="glass-button p-2 rounded-lg hover:bg-cyan-900/30 transition-colors"
                title="Clear Terminal (Ctrl+K)"
              >
                <RefreshIcon className="w-4 h-4 text-gray-400 hover:text-yellow-300" />
              </button>
            </div>
          </div>
          
          {/* Connection Status Bar */}
          <div className="mt-3 flex items-center justify-between text-xs">
            <div className="flex items-center space-x-3">
              <span className="font-mono text-gray-500">{serverName}</span>
              <span className="text-gray-600">|</span>
              <span className="text-gray-500">ID: {serverId.slice(0, 8)}...</span>
            </div>
            <div className="flex items-center space-x-2">
              {isTransferring && (
                <span className="px-2 py-1 bg-yellow-500/20 text-yellow-400 rounded text-xs animate-pulse">
                  ⚡ Transferring...
                </span>
              )}
              <span className={`px-2 py-1 rounded ${connected ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                {connected ? <StatusOnlineIcon className="w-3 h-3 inline mr-1" /> : <StatusOfflineIcon className="w-3 h-3 inline mr-1" />}
                {connected ? 'Connected' : 'Disconnected'}
              </span>
            </div>
          </div>
        </div>

        {/* Spinner Overlay */}
        <SpinnerOverlay visible={!connected} size={'large'} />

        {/* Terminal Content */}
        <div className={classNames(
          styles.container, 
          styles.overflows_container,
          'glass-console rounded-t-none border-t-0 min-h-[500px]'
        )}>
          <div className="h-full p-1">
            <div 
              id={styles.terminal} 
              ref={ref}
              className="rounded-lg"
            />
          </div>
        </div>

        {/* Command Input */}
        {canSendCommands && (
          <div className="glass-input-group relative border-t border-cyan-500/10">
            <div className="absolute left-6 top-1/2 transform -translate-y-1/2 flex items-center space-x-3">
              <ChevronDoubleRightIcon className="w-5 h-5 text-cyan-400 animate-pulse" />
              <div className="flex space-x-1">
                {['F1', 'Ctrl+F', 'Ctrl+K'].map((shortcut, i) => (
                  <kbd key={i} className="px-2 py-1 text-xs bg-gray-900/50 text-gray-400 rounded border border-gray-700">
                    {shortcut}
                  </kbd>
                ))}
              </div>
            </div>
            <input
              className="w-full pl-32 pr-6 py-5 bg-transparent border-none outline-none 
                text-gray-100 placeholder-gray-500 font-mono text-sm
                focus:ring-0 focus:border-transparent focus:placeholder-cyan-900/30
                disabled:opacity-50 disabled:cursor-not-allowed"
              type="text"
              placeholder={connected ? "Type command and press Enter (↑↓ for history, Tab for completion)" : "Connecting to server..."}
              aria-label="Console command input"
              disabled={!instance || !connected}
              onKeyDown={handleCommandKeyDown}
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              autoFocus
            />
            <div className="absolute right-6 top-1/2 transform -translate-y-1/2 text-xs text-gray-500 font-mono">
              {historyIndex >= 0 ? `History ${historyIndex + 1}/${history?.length}` : 'Ready'}
            </div>
          </div>
        )}

        {/* Terminal Footer */}
        <div className="glass-footer px-6 py-3 border-t border-cyan-500/10 bg-gray-900/30">
          <div className="flex items-center justify-between text-xs text-gray-500">
            <div className="flex items-center space-x-4">
              <span>Pterodactyl Panel • IceMinecraft Theme</span>
              <span className="hidden md:inline">•</span>
              <span className="hidden md:inline">Terminal v2.0</span>
            </div>
            <div className="flex items-center space-x-2">
              <span className="font-mono">◼</span>
              <span className="font-mono">●</span>
              <span className="font-mono">○</span>
            </div>
          </div>
        </div>
      </div>

      {/* Search Bar Notification */}
      {isSearchVisible && (
        <div className="absolute bottom-24 right-6 bg-cyan-900/80 backdrop-blur-sm text-cyan-100 px-4 py-2 rounded-lg shadow-lg animate-fadeIn">
          <div className="flex items-center space-x-2">
            <SearchIcon className="w-4 h-4" />
            <span className="text-sm">Search active - Press ESC to close</span>
          </div>
        </div>
      )}
    </div>
  );
};

// Tambahkan style ini ke file CSS global atau inline
const inlineStyles = `
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

.glass-header {
  background: rgba(10, 25, 47, 0.9);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}

.glass-button {
  background: rgba(30, 64, 104, 0.3);
  border: 1px solid rgba(100, 255, 218, 0.1);
  transition: all 0.2s ease;
}

.glass-button:hover {
  border-color: rgba(100, 255, 218, 0.3);
  background: rgba(100, 255, 218, 0.1);
}

.glass-console {
  background: rgba(10, 25, 47, 0.95);
  backdrop-filter: blur(5px);
  -webkit-backdrop-filter: blur(5px);
}

.glass-input-group {
  background: rgba(17, 34, 64, 0.8);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border: 1px solid rgba(100, 255, 218, 0.15);
}

.glass-footer {
  background: rgba(10, 25, 47, 0.8);
  backdrop-filter: blur(5px);
  -webkit-backdrop-filter: blur(5px);
}

.animate-fadeIn {
  animation: fadeIn 0.3s ease-out;
}

/* Custom scrollbar untuk terminal */
.xterm-viewport::-webkit-scrollbar {
  width: 12px;
}

.xterm-viewport::-webkit-scrollbar-track {
  background: rgba(10, 25, 47, 0.5);
  border-radius: 6px;
}

.xterm-viewport::-webkit-scrollbar-thumb {
  background: linear-gradient(180deg, #64ffda, #1e4068);
  border-radius: 6px;
  border: 3px solid rgba(10, 25, 47, 0.5);
}

.xterm-viewport::-webkit-scrollbar-thumb:hover {
  background: linear-gradient(180deg, #52d9b8, #165c9c);
}
`;

// Inject inline styles
if (typeof document !== 'undefined') {
  const styleElement = document.createElement('style');
  styleElement.textContent = inlineStyles;
  document.head.appendChild(styleElement);
}
