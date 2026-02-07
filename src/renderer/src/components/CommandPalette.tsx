import React, { useState, useEffect } from 'react';
import { Command } from 'cmdk';
import { Search, Loader2, Bot, Trash2, Layout, Settings } from 'lucide-react';
import { useChatStore } from '../stores/chatStore';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '../lib/utils';

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const { clearMessages, toggleSidebar } = useChatStore();

  // Toggle with Cmd+K
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((open) => !open);
      }
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, []);

  const itemClass = "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-white/80 aria-selected:bg-[#00a896] aria-selected:text-white cursor-pointer transition-colors";

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]">
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
            className="w-full max-w-lg relative z-50"
          >
            <Command 
                className="bg-[#1a1d23] border border-white/10 rounded-xl shadow-2xl overflow-hidden"
                loop
            >
              <div className="flex items-center border-b border-white/5 px-4">
                <Search size={16} className="text-white/40 mr-3" />
                <Command.Input 
                    placeholder="Type a command or search..." 
                    className="flex-1 bg-transparent py-4 text-sm text-white placeholder-white/40 outline-none"
                    autoFocus
                />
              </div>

              <Command.List className="max-h-[300px] overflow-y-auto p-2 scroll-py-2">
                <Command.Empty className="py-6 text-center text-sm text-white/40">
                    No results found.
                </Command.Empty>

                <Command.Group heading="Actions" className="text-xs font-bold text-white/30 uppercase tracking-wider mb-2 px-2">
                    <Command.Item 
                        onSelect={() => {
                            clearMessages();
                            setOpen(false);
                        }}
                        className={itemClass}
                    >
                        <Trash2 size={16} />
                        <span>Clear Chat</span>
                        <span className="ml-auto text-xs opacity-50">Cmd+Del</span>
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
                        <span className="ml-auto text-xs opacity-50">Cmd+B</span>
                    </Command.Item>
                     <Command.Item 
                        onSelect={() => {
                            setOpen(false);
                        }}
                        className={itemClass}
                    >
                        <Settings size={16} />
                        <span>Settings</span>
                        <span className="ml-auto text-xs opacity-50">Cmd+,</span>
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
            <div className="absolute top-full left-0 right-0 mt-2 flex justify-center gap-4 text-[10px] text-white/40 font-medium">
                <span className="flex items-center gap-1">
                    <kbd className="bg-white/10 px-1.5 py-0.5 rounded">↵</kbd>
                    select
                </span>
                <span className="flex items-center gap-1">
                    <kbd className="bg-white/10 px-1.5 py-0.5 rounded">↓</kbd>
                    <kbd className="bg-white/10 px-1.5 py-0.5 rounded">↑</kbd>
                    navigate
                </span>
                <span className="flex items-center gap-1">
                    <kbd className="bg-white/10 px-1.5 py-0.5 rounded">esc</kbd>
                    close
                </span>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
