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
import { ChevronDoubleRightIcon } from '@heroicons/react/solid';

import 'xterm/css/xterm.css';
import styles from './style.module.css';

const theme = {
  background: 'rgba(15, 25, 35, 0.7)',
  cursor: 'transparent',
  black: '#0F1923',
  red: '#E54B4B',
  green: '#5BC0BE',
  yellow: '#FFD166',
  blue: '#4A9FF5',
  magenta: '#9D4EDD',
  cyan: '#2DDAFD',
  white: '#d0d0d0',
  brightBlack: 'rgba(255, 255, 255, 0.2)',
  brightRed: '#FF6B6B',
  brightGreen: '#C3E88D',
  brightYellow: '#FFCB6B',
  brightBlue: '#82AAFF',
  brightMagenta: '#C792EA',
  brightCyan: '#89DDFF',
  brightWhite: '#ffffff',
  selection: 'rgba(74, 159, 245, 0.3)',
};

const terminalProps: ITerminalOptions = {
  disableStdin: true,
  cursorStyle: 'underline',
  allowTransparency: true,
  fontSize: 13,
  fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
  rows: 30,
  theme: theme,
  letterSpacing: 0.5,
};

export default () => {
  const TERMINAL_PRELUDE = '\u001b[1m\u001b[33mcontainer@pterodactyl~ \u001b[0m';
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
  const isTransferring = ServerContext.useStoreState((state) => state.server.data!.isTransferring);
  const [history, setHistory] = usePersistedState<string[]>(`${serverId}:command_history`, []);
  const [historyIndex, setHistoryIndex] = useState(-1);

  const handleConsoleOutput = (line: string, prelude = false) =>
    terminal.writeln((prelude ? TERMINAL_PRELUDE : '') + line.replace(/(?:\r\n|\r|\n)$/im, '') + '\u001b[0m');

  const handleTransferStatus = (status: string) => {
    switch (status) {
      // Sent by either the source or target node if a failure occurs.
      case 'failure':
        terminal.writeln(TERMINAL_PRELUDE + 'Transfer has failed.\u001b[0m');
        return;

      // Sent by the source node whenever the server was archived successfully.
      case 'archive':
        terminal.writeln(
          TERMINAL_PRELUDE + 'Server has been archived successfully, attempting connection to target node..\u001b[0m'
        );
    }
  };

  const handleDaemonErrorOutput = (line: string) =>
    terminal.writeln(TERMINAL_PRELUDE + '\u001b[1m\u001b[41m' + line.replace(/(?:\r\n|\r|\n)$/im, '') + '\u001b[0m');

  const handlePowerChangeEvent = (state: string) =>
    terminal.writeln(TERMINAL_PRELUDE + 'Server marked as ' + state + '...\u001b[0m');

  const handleCommandKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowUp') {
      const newIndex = Math.min(historyIndex + 1, history!.length - 1);

      setHistoryIndex(newIndex);
      e.currentTarget.value = history![newIndex] || '';

      // By default up arrow will also bring the cursor to the start of the line,
      // so we'll preventDefault to keep it at the end.
      e.preventDefault();
    }

    if (e.key === 'ArrowDown') {
      const newIndex = Math.max(historyIndex - 1, -1);

      setHistoryIndex(newIndex);
      e.currentTarget.value = history![newIndex] || '';
    }

    const command = e.currentTarget.value;
    if (e.key === 'Enter' && command.length > 0) {
      setHistory((prevHistory) => [command, ...prevHistory!].slice(0, 32));
      setHistoryIndex(-1);

      instance && instance.send('send command', command);
      e.currentTarget.value = '';
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

      // Add support for capturing keys
      terminal.attachCustomKeyEventHandler((e: KeyboardEvent) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
          document.execCommand('copy');
          return false;
        } else if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
          e.preventDefault();
          searchBar.show();
          return false;
        } else if (e.key === 'Escape') {
          searchBar.hidden();
        }
        return true;
      });
    }
  }, [terminal, connected]);

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
      // Do not clear the console if the server is being transferred.
      if (!isTransferring) {
        terminal.clear();
      }

      Object.keys(listeners).forEach((key: string) => {
        instance.addListener(key, listeners[key]);
      });
      instance.send(SocketRequest.SEND_LOGS);
    }

    return () => {
      if (instance) {
        Object.keys(listeners).forEach((key: string) => {
          instance.removeListener(key, listeners[key]);
        });
      }
    };
  }, [connected, instance]);

return (
    <div className={classNames(styles.terminal, 'relative')}>
      <SpinnerOverlay visible={!connected} size={'large'} />
      <div className={classNames(styles.container, styles.overflows_container, { 'rounded-b': !canSendCommands })}>
        <div className={'h-full'}>
          <div 
            id={styles.terminal} 
            ref={ref} 
            className="rounded-lg overflow-hidden border border-blue-500/20 shadow-lg"
          />
        </div>
      </div>
      {canSendCommands && (
        <div className={classNames('relative', styles.overflows_container, 'mt-4')}>
          <input
            className={classNames(
              'peer', 
              styles.command_input,
              'bg-gray-800/70 backdrop-blur-sm border border-blue-500/30 rounded-lg',
              'focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20'
            )}
            type={'text'}
            placeholder={'Type a command...'}
            aria-label={'Console command input.'}
            disabled={!instance || !connected}
            onKeyDown={handleCommandKeyDown}
            autoCorrect={'off'}
            autoCapitalize={'none'}
          />
          <div
            className={classNames(
              'text-blue-400 peer-focus:text-blue-300 peer-focus:animate-pulse',
              styles.command_icon
            )}
          >
            <ChevronDoubleRightIcon className={'w-4 h-4'} />
          </div>
        </div>
      )}
    </div>
  );
};
