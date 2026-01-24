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

  return (
    <div className="border-2 border-blue-500/50 bg-blue-500/10 rounded-lg p-4 my-3 backdrop-blur-sm">
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <h3 className="text-lg font-semibold text-blue-300">I need clarification</h3>
        </div>
        <button 
          onClick={onBypass}
          className="text-xs text-gray-400 hover:text-gray-300 underline"
        >
          Skip & Execute As-Is
        </button>
      </div>

      {/* Detected Intent */}
      <div className="mb-3">
        <p className="text-sm text-gray-300">
          <span className="font-medium text-blue-300">What I understood:</span> {analysis.detectedIntent}
        </p>
      </div>

      {/* Missing Details */}
      {analysis.missingDetails.length > 0 && (
        <div className="mb-3 bg-yellow-500/10 border border-yellow-500/30 rounded p-2">
          <p className="text-xs font-medium text-yellow-300 mb-1">Missing details:</p>
          <ul className="text-sm text-yellow-200 space-y-1">
            {analysis.missingDetails.map((detail, idx) => (
              <li key={idx} className="flex items-start gap-2">
                <span className="text-yellow-400">•</span>
                <span>{detail}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Potential Mistakes */}
      {analysis.potentialMistakes.length > 0 && (
        <div className="mb-3 bg-red-500/10 border border-red-500/30 rounded p-2">
          <p className="text-xs font-medium text-red-300 mb-1">Possible typos:</p>
          <ul className="text-sm text-red-200 space-y-1">
            {analysis.potentialMistakes.map((mistake, idx) => (
              <li key={idx} className="flex items-start gap-2">
                <span className="text-red-400">•</span>
                <span>{mistake}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Suggestions */}
      <div className="mb-3">
        <p className="text-xs font-medium text-gray-400 mb-2">Select what you meant:</p>
        <div className="space-y-2">
          {analysis.suggestions.map((suggestion) => (
            <button
              key={suggestion.id}
              onClick={() => onConfirm(suggestion.enrichedPrompt)}
              className="w-full text-left px-4 py-3 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/40 hover:border-blue-400/60 rounded-lg transition-all duration-200 group"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <p className="text-sm font-medium text-blue-100 group-hover:text-blue-50">
                    {suggestion.label}
                  </p>
                  {showDetails && (
                    <p className="text-xs text-gray-400 mt-1">
                      {suggestion.enrichedPrompt}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-blue-400 font-mono">
                    {Math.round(suggestion.confidence * 100)}%
                  </span>
                  <svg className="w-4 h-4 text-blue-400 opacity-0 group-hover:opacity-100 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </div>
            </button>
          ))}
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
