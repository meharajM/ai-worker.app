import React, { useState, useEffect } from 'react';
import { Command } from 'cmdk';
import { Search, Bot, Trash2, Layout, Settings, Zap, WifiOff } from 'lucide-react';
import { useChatStore } from '../stores/chatStore';
import { motion, AnimatePresence } from 'framer-motion';
import { View } from './Sidebar';
import { WhatsAppConnectionDialog } from './WhatsAppConnectionDialog';
import { whatsappService } from '../lib/whatsappService';

interface CommandPaletteProps {
  onViewChange?: (view: View) => void;
}

export function CommandPalette({ onViewChange }: CommandPaletteProps) {
  const [open, setOpen] = useState(false);
  const [showPhoneDialog, setShowPhoneDialog] = useState(false);

  const { clearMessages, toggleSidebar, whatsappEnabled, setWhatsAppEnabled } = useChatStore();
  const isWhatsAppConnected = whatsappEnabled;

  const handleConnectWhatsApp = async () => {
    setShowPhoneDialog(true);
  };

  const handleDisconnectWhatsApp = async () => {
    await whatsappService.disconnect();
    setWhatsAppEnabled(false);
  };

  const handleClearWhatsApp = async () => {
    await whatsappService.disconnect();
    setWhatsAppEnabled(false);
  };

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((open) => !open);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, []);

  // List Item classes (Matches standard actions style)
  const itemClass = "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-white/80 aria-selected:bg-[var(--color-primary)] aria-selected:text-white cursor-pointer transition-colors";

  return (
    <>
      <AnimatePresence>
        {open && (
          <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh]">
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm"
            />

            {/* Command Dialog */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: -20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -20 }}
              transition={{ duration: 0.2 }}
              className="w-full max-w-3xl relative z-50"
            >
              <Command
                className="bg-[var(--color-bg-dark)] border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
                loop
              >
                <div className="flex items-center border-b border-white/5 px-6 shrink-0 bg-[var(--color-surface)]">
                  <Search size={20} className="text-white/40 mr-4" />
                  <Command.Input
                    placeholder="Type a command, search agents..."
                    className="flex-1 bg-transparent py-5 text-base text-white placeholder-white/40 outline-none"
                    autoFocus
                  />
                </div>

                <Command.List className="max-h-[60vh] overflow-y-auto p-4 scroll-py-4">
                  <Command.Empty className="py-12 text-center text-sm text-white/40">
                    No matching commands or agents found.
                  </Command.Empty>


                  <Command.Group heading="Actions" className="text-xs font-bold text-white/30 uppercase tracking-wider mb-2 px-2 mt-6">
                    <Command.Item
                      onSelect={() => {
                        clearMessages();
                        setOpen(false);
                      }}
                      className={itemClass}
                    >
                      <Trash2 size={16} />
                      <span>Clear Chat</span>
                      <span className="ml-auto text-xs opacity-50 font-mono">Cmd+Del</span>
                    </Command.Item>
                  </Command.Group>

                  <Command.Group heading="WhatsApp (Human-in-the-Loop)" className="text-xs font-bold text-white/30 uppercase tracking-wider mb-2 px-2 mt-4">
                      {!isWhatsAppConnected && (
                        <Command.Item
                          onSelect={() => {
                            handleConnectWhatsApp();
                            setOpen(false);
                          }}
                          className={itemClass}
                        >
                          <Zap size={16} className="text-[#4fd1c5]" />
                          <span>Connect WhatsApp</span>
                        </Command.Item>
                      )}
                      {isWhatsAppConnected && (
                        <>
                          <Command.Item
                            onSelect={() => {
                              handleDisconnectWhatsApp();
                              setOpen(false);
                            }}
                            className={itemClass}
                          >
                            <WifiOff size={16} className="text-yellow-400" />
                            <span>Disconnect WhatsApp</span>
                          </Command.Item>
                          <Command.Item
                            onSelect={() => {
                              setShowPhoneDialog(true);
                              setOpen(false);
                            }}
                            className={itemClass}
                          >
                            <Settings size={16} className="text-blue-400" />
                            <span>Change WhatsApp Target Number</span>
                          </Command.Item>
                        </>
                      )}
                      <Command.Item
                        onSelect={() => {
                          handleClearWhatsApp();
                          setOpen(false);
                        }}
                        className={itemClass}
                      >
                        <Trash2 size={16} className="text-red-400" />
                        <span>Clear WhatsApp Data & Configuration</span>
                      </Command.Item>
                    </Command.Group>

                  <Command.Group heading="Navigation" className="text-xs font-bold text-white/30 uppercase tracking-wider mb-2 px-2 mt-4">
                    <Command.Item
                      onSelect={() => {
                        toggleSidebar();
                        setOpen(false);
                      }}
                      className={itemClass}
                    >
                      <Layout size={16} />
                      <span>Toggle Sidebar</span>
                      <span className="ml-auto text-xs opacity-50 font-mono">Cmd+B</span>
                    </Command.Item>
                    <Command.Item
                      onSelect={() => {
                        onViewChange?.('connections');
                        setOpen(false);
                      }}
                      className={itemClass}
                    >
                      <Search size={16} />
                      <span>MCP Connections</span>
                      <span className="ml-auto text-xs opacity-50 font-mono">Cmd+K</span>
                    </Command.Item>
                    <Command.Item
                      onSelect={() => {
                        onViewChange?.('settings');
                        setOpen(false);
                      }}
                      className={itemClass}
                    >
                      <Settings size={16} />
                      <span>Settings</span>
                      <span className="ml-auto text-xs opacity-50 font-mono">Cmd+,</span>
                    </Command.Item>
                  </Command.Group>

                  <Command.Group heading="AI Models" className="text-xs font-bold text-white/30 uppercase tracking-wider mb-2 px-2 mt-4">
                    <Command.Item
                      onSelect={() => setOpen(false)}
                      className={itemClass}
                    >
                      <Bot size={16} />
                      <span>Switch to GPT-4o</span>
                    </Command.Item>
                    <Command.Item
                      onSelect={() => setOpen(false)}
                      className={itemClass}
                    >
                      <Bot size={16} />
                      <span>Switch to Claude 3.5 Sonnet</span>
                    </Command.Item>
                  </Command.Group>

                </Command.List>
              </Command>

              {/* Footer hint */}
              <div className="absolute top-full left-0 right-0 mt-3 flex justify-center gap-4 text-[10px] text-white/40 font-medium">
                <span className="flex items-center gap-1">
                  <kbd className="bg-black/40 border border-white/10 px-1.5 py-0.5 rounded shadow-sm">↵</kbd>
                  select
                </span>
                <span className="flex items-center gap-1">
                  <kbd className="bg-black/40 border border-white/10 px-1.5 py-0.5 rounded shadow-sm">↓</kbd>
                  <kbd className="bg-black/40 border border-white/10 px-1.5 py-0.5 rounded shadow-sm">↑</kbd>
                  navigate
                </span>
                <span className="flex items-center gap-1">
                  <kbd className="bg-black/40 border border-white/10 px-1.5 py-0.5 rounded shadow-sm">esc</kbd>
                  close
                </span>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <WhatsAppConnectionDialog open={showPhoneDialog} onOpenChange={setShowPhoneDialog} />
    </>
  );
}
