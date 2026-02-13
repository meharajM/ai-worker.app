import React, { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { TaskAnalysis } from '../lib/confirmation-message';
import { TaskConfirmationCard } from './TaskConfirmationCard'; // Re-use the content card
import { X } from 'lucide-react';
import { cn } from '../lib/utils';

interface TaskConfirmationDialogProps {
    open: boolean;
    analysis: TaskAnalysis | null;
    onConfirm: (enrichedPrompt: string) => void;
    onCancel: () => void;
    onBypass: () => void;
}

export function TaskConfirmationDialog({
    open,
    analysis,
    onConfirm,
    onCancel,
    onBypass
}: TaskConfirmationDialogProps) {
    if (!analysis) return null;

    return (
        <Dialog.Root open={open} onOpenChange={(isOpen) => !isOpen && onCancel()}>
            <Dialog.Portal>
                {/* Backdrop */}
                <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm data-[state=open]:animate-overlayShow z-50" />
                
                {/* Content */}
                <Dialog.Content className={cn(
                    "fixed left-[50%] top-[50%] max-h-[85vh] w-[90vw] max-w-[600px] translate-x-[-50%] translate-y-[-50%]",
                    "rounded-[16px] bg-[#0f1115] border border-white/10 p-[24px] overflow-y-auto focus:outline-none z-50",
                    "shadow-[hsl(206_22%_7%_/_35%)_0px_10px_38px_-10px,_hsl(206_22%_7%_/_20%)_0px_10px_20px_-15px]",
                    "data-[state=open]:animate-contentShow"
                )}>
                    
                    <Dialog.Title className="text-white text-lg font-bold mb-4 flex items-center justify-between">
                        <span>Task Confirmation</span>
                        <Dialog.Close asChild>
                            <button className="text-white/40 hover:text-white transition-colors p-1 rounded-md hover:bg-white/5" aria-label="Close">
                                <X size={16} />
                            </button>
                        </Dialog.Close>
                    </Dialog.Title>

                    {/* We reuse the existing card logic but render it inside the dialog */}
                    <TaskConfirmationCard 
                        analysis={analysis} 
                        onConfirm={onConfirm} 
                        onCancel={onCancel} 
                        onBypass={onBypass} 
                    />

                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
