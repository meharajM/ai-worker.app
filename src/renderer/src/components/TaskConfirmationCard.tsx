import React, { useState } from 'react';
import { TaskAnalysis, TaskSuggestion } from '../lib/confirmation-message';

interface TaskConfirmationCardProps {
  analysis: TaskAnalysis;
  onConfirm: (enrichedPrompt: string) => void;
  onCancel: () => void;
  onBypass: () => void;
}

export function TaskConfirmationCard({
  analysis,
  onConfirm,
  onCancel,
  onBypass
}: TaskConfirmationCardProps) {
  const [showDetails, setShowDetails] = useState(false);
  const [customInput, setCustomInput] = useState('');

  return (
    <div className="border-2 border-blue-500/50 bg-blue-500/10 rounded-lg p-4 my-3 backdrop-blur-sm">
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-blue-500/20 rounded-full">
            <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-blue-100">Quick Check</h3>
            <p className="text-xs text-blue-300/80">I want to make sure I help you correctly</p>
          </div>
        </div>
        <button
          onClick={onBypass}
          className="text-xs text-blue-400/60 hover:text-blue-300 transition-colors"
        >
          Skip
        </button>
      </div>

      {/* Complexity & Time Estimate */}
      {analysis.complexity && (
        <div className="mb-4 flex items-center gap-3 bg-blue-950/30 rounded-lg p-2 border border-blue-500/20">
          <div className={`px-2 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider ${analysis.complexity.level === 'simple' ? 'bg-green-500/20 text-green-300 border-green-500/30' :
              analysis.complexity.level === 'moderate' ? 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30' :
                'bg-orange-500/20 text-orange-300 border-orange-500/30'
            } border`}>
            {analysis.complexity.level}
          </div>
          <div className="h-3 w-px bg-white/10" />
          <div className="flex items-center gap-1.5 text-xs text-blue-200">
            <svg className="w-3.5 h-3.5 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>{analysis.complexity.estimatedTime}</span>
          </div>
          <div className="h-3 w-px bg-white/10" />
          <p className="text-xs text-blue-300/80 truncate flex-1" title={analysis.complexity.userFriendlyMessage}>
            {analysis.complexity.userFriendlyMessage}
          </p>
        </div>
      )}

      {/* Detected Intent */}
      <div className="mb-4">
        <p className="text-sm text-gray-300 leading-relaxed">
          <span className="text-blue-400 font-medium">I understood:</span> {analysis.detectedIntent}
        </p>
      </div>

      {/* Missing Details */}
      {analysis.missingDetails.length > 0 && (
        <div className="mb-4 bg-yellow-500/5 border border-yellow-500/20 rounded-lg p-3">
          <p className="text-xs font-medium text-yellow-500/90 mb-2 flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Missing Info
          </p>
          <ul className="space-y-1.5">
            {analysis.missingDetails.map((detail, idx) => (
              <li key={idx} className="flex items-start gap-2 text-xs text-yellow-200/80">
                <span className="mt-1 w-1 h-1 rounded-full bg-yellow-500/50 flex-shrink-0" />
                <span>{detail}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Suggestions */}
      <div className="mb-4">
        <p className="text-xs font-medium text-gray-400 mb-2 uppercase tracking-wider">How should I proceed?</p>
        <div className="space-y-2">
          {analysis.suggestions.map((suggestion) => (
            <button
              key={suggestion.id}
              onClick={() => onConfirm(suggestion.enrichedPrompt)}
              className="w-full text-left p-3 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 hover:border-blue-400/40 rounded-lg transition-all duration-200 group"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <p className="text-sm text-blue-100 group-hover:text-white transition-colors">
                    {suggestion.label}
                  </p>
                  {showDetails && (
                    <p className="text-xs text-blue-300/60 mt-1.5 border-t border-blue-500/10 pt-1.5">
                      "{suggestion.enrichedPrompt}"
                    </p>
                  )}
                </div>
                <div className="pt-0.5">
                  <svg className="w-4 h-4 text-blue-500 group-hover:text-blue-400 transition-colors transform group-hover:translate-x-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Custom Input */}
      <div className="mb-3">
        <div className="relative group">
          <textarea
            value={customInput}
            onChange={(e) => setCustomInput(e.target.value)}
            placeholder="Type your own instructions..."
            className="w-full bg-black/20 border border-white/10 rounded-lg p-3 pr-20 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500/40 focus:bg-black/30 transition-all resize-none h-12 py-2.5"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (customInput.trim()) onConfirm(customInput);
              }
            }}
          />
          <button
            onClick={() => customInput.trim() && onConfirm(customInput)}
            disabled={!customInput.trim()}
            className="absolute right-2 top-1/2 -translate-y-1/2 px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded transition-colors disabled:opacity-0 disabled:pointer-events-none"
          >
            Send
          </button>
        </div>
      </div>

      {/* Footer Actions */}
      <div className="flex items-center justify-between pt-2 border-t border-white/10">
        <button
          onClick={() => setShowDetails(!showDetails)}
          className="text-xs text-gray-400 hover:text-gray-300 flex items-center gap-1"
        >
          <svg className={`w-3 h-3 transition-transform ${showDetails ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
          {showDetails ? 'Hide' : 'Show'} details
        </button>
        <button
          onClick={onCancel}
          className="text-sm text-gray-400 hover:text-white transition-colors"
        >
          Let me rephrase
        </button>
      </div>
    </div>
  );
}
