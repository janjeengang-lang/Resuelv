import { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { MessageSquare, Minimize2, Maximize2, Zap, Eye, Settings } from 'lucide-react';

export function FloatingBubble() {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [assistantState, setAssistantState] = useState<'idle' | 'listening' | 'thinking'>('idle');

  useEffect(() => {
    // Simulate assistant activity
    const interval = setInterval(() => {
      if (Math.random() > 0.8) {
        setAssistantState('thinking');
        setTimeout(() => setAssistantState('idle'), 2000);
      }
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  const getAssistantMessage = () => {
    switch (assistantState) {
      case 'listening': return 'Listening...';
      case 'thinking': return 'Analyzing...';
      default: return 'Ready to assist';
    }
  };

  const getBorderColor = () => {
    switch (assistantState) {
      case 'listening': return 'border-yellow-500 neon-glow-yellow';
      case 'thinking': return 'border-blue-500';
      default: return 'border-green-500 neon-glow';
    }
  };

  return (
    <div 
      className={`fixed bottom-6 right-6 z-50 floating-animation transition-all duration-500 ${
        isExpanded ? 'w-80 h-64' : 'w-16 h-16'
      }`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div 
        className={`w-full h-full overflow-hidden cursor-pointer glass-morphism transition-all duration-300 ${
          isExpanded ? 'rounded-lg border-2' : 'rounded-full border-3'
        } ${getBorderColor()}`}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        {isExpanded ? (
          <div className="p-4 text-white h-full flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center space-x-2">
                <div className={`w-3 h-3 rounded-full ${
                  assistantState === 'thinking' ? 'bg-blue-500 animate-pulse' :
                  assistantState === 'listening' ? 'bg-yellow-500 animate-pulse' :
                  'bg-green-500'
                }`}></div>
                <span className="text-sm text-green-400">ZEPRA ASSISTANT</span>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsExpanded(false);
                }}
                className="w-6 h-6 p-0 hover:bg-gray-800"
              >
                <Minimize2 className="w-3 h-3" />
              </Button>
            </div>

            {/* Video Area */}
            <div className="video-placeholder h-32 mb-3 rounded-lg border border-gray-700">
              <div className="text-center">
                <div className="text-xs opacity-75 mb-1">ASSISTANT VIDEO</div>
                <div className="text-xs">zepra.webm</div>
              </div>
            </div>

            {/* Status */}
            <div className="text-center mb-3">
              <div className="text-xs text-gray-400 mb-1">{getAssistantMessage()}</div>
              <div className="h-px bg-gradient-to-r from-transparent via-green-500 to-transparent"></div>
            </div>

            {/* Quick Actions */}
            <div className="flex space-x-2 mt-auto">
              <Button
                size="sm"
                onClick={(e) => e.stopPropagation()}
                className="flex-1 bg-green-600 hover:bg-green-700 text-black text-xs py-2 neon-glow cyber-button"
              >
                <MessageSquare className="w-3 h-3 mr-1" />
                Chat
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={(e) => e.stopPropagation()}
                className="border-yellow-500 text-yellow-400 hover:bg-yellow-950 text-xs py-2 neon-glow-yellow"
              >
                <Zap className="w-3 h-3" />
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={(e) => e.stopPropagation()}
                className="border-gray-500 text-gray-400 hover:bg-gray-800 text-xs py-2"
              >
                <Settings className="w-3 h-3" />
              </Button>
            </div>
          </div>
        ) : (
          <div className="relative w-full h-full">
            {/* Video Content */}
            <div className="video-placeholder w-full h-full rounded-full">
              <div className="text-center">
                <div className="text-xs opacity-75 mb-1">AI</div>
                <div className="text-xs">zepra</div>
              </div>
            </div>

            {/* Hover Expand Hint */}
            {isHovered && (
              <div className="absolute -top-10 left-1/2 transform -translate-x-1/2 bg-gray-900 border border-gray-700 rounded-lg px-3 py-1 text-xs text-white neon-glow">
                <div className="flex items-center space-x-1">
                  <Maximize2 className="w-3 h-3" />
                  <span>Expand Assistant</span>
                </div>
                <div className="absolute top-full left-1/2 transform -translate-x-1/2 w-2 h-2 bg-gray-900 border-r border-b border-gray-700 rotate-45"></div>
              </div>
            )}

            {/* Activity Indicator */}
            {assistantState !== 'idle' && (
              <div className="absolute -top-2 -right-2 w-6 h-6 bg-blue-600 rounded-full flex items-center justify-center neon-glow animate-pulse">
                <Eye className="w-3 h-3 text-white" />
              </div>
            )}

            {/* Pulse Ring Effect */}
            <div className="absolute inset-0 rounded-full border-2 border-green-500 opacity-50 animate-ping"></div>
          </div>
        )}
      </div>
    </div>
  );
}