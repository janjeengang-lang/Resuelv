import { useState } from 'react';
import { Button } from './ui/button';
import { VideoHeader } from './VideoHeader';
import { X, Copy, Eye, RotateCcw, MessageSquare, Layout, Maximize2 } from 'lucide-react';

interface Answer {
  id: string;
  title: string;
  content: string;
  reasoning?: string;
  confidence: number;
}

interface ZepraAnswerModalProps {
  answers: Answer[];
  question: string;
  onClose: () => void;
  showReasoning?: boolean;
}

export function ZepraAnswerModal({ 
  answers, 
  question, 
  onClose, 
  showReasoning = false 
}: ZepraAnswerModalProps) {
  const [viewMode, setViewMode] = useState<'single' | 'cards' | 'split'>('single');
  const [selectedAnswer, setSelectedAnswer] = useState(0);
  const [showReasoningPane, setShowReasoningPane] = useState(showReasoning);

  const copyAnswer = (content: string) => {
    navigator.clipboard.writeText(content);
  };

  const copyAllAnswers = () => {
    const allAnswers = answers.map((answer, index) => 
      `Answer ${index + 1}: ${answer.content}`
    ).join('\n\n');
    navigator.clipboard.writeText(allAnswers);
  };

  const renderSingleView = () => (
    <div className="space-y-4">
      {/* Answer Navigation */}
      {answers.length > 1 && (
        <div className="flex items-center justify-between bg-gray-800 rounded-lg p-3 border border-gray-600">
          <span className="text-gray-400 text-sm">
            Answer {selectedAnswer + 1} of {answers.length}
          </span>
          <div className="flex space-x-2">
            <Button
              onClick={() => setSelectedAnswer(Math.max(0, selectedAnswer - 1))}
              disabled={selectedAnswer === 0}
              size="sm"
              variant="outline"
              className="border-green-500 text-green-400"
            >
              ←
            </Button>
            <Button
              onClick={() => setSelectedAnswer(Math.min(answers.length - 1, selectedAnswer + 1))}
              disabled={selectedAnswer === answers.length - 1}
              size="sm"
              variant="outline"
              className="border-green-500 text-green-400"
            >
              →
            </Button>
          </div>
        </div>
      )}

      {/* Single Answer Display */}
      <div className="bg-gray-800 rounded-lg p-6 border border-gray-600 data-card">
        <div className="flex justify-between items-start mb-4">
          <h3 className="text-lg text-green-400">{answers[selectedAnswer].title}</h3>
          <div className="flex items-center space-x-2">
            <span className="text-xs text-gray-400">
              {answers[selectedAnswer].confidence}% confidence
            </span>
            <div className={`w-2 h-2 rounded-full ${
              answers[selectedAnswer].confidence > 80 ? 'bg-green-500' : 
              answers[selectedAnswer].confidence > 60 ? 'bg-yellow-500' : 'bg-red-500'
            }`}></div>
          </div>
        </div>
        <p className="text-white text-lg leading-relaxed">{answers[selectedAnswer].content}</p>
        <Button
          onClick={() => copyAnswer(answers[selectedAnswer].content)}
          className="mt-4 bg-green-600 hover:bg-green-700 text-black neon-glow cyber-button"
        >
          <Copy className="w-4 h-4 mr-2" />
          COPY ANSWER
        </Button>
      </div>
    </div>
  );

  const renderCardsView = () => (
    <div className="space-y-4 max-h-96 overflow-y-auto">
      {answers.map((answer, index) => (
        <div key={answer.id} className="bg-gray-800 rounded-lg p-4 border border-gray-600 data-card">
          <div className="flex justify-between items-start mb-3">
            <h3 className="text-green-400">Answer {index + 1}</h3>
            <div className="flex items-center space-x-2">
              <span className="text-xs text-gray-400">{answer.confidence}%</span>
              <Button
                onClick={() => copyAnswer(answer.content)}
                size="sm"
                variant="outline"
                className="border-green-500 text-green-400 hover:bg-green-950 neon-glow"
              >
                <Copy className="w-3 h-3" />
              </Button>
            </div>
          </div>
          <p className="text-white">{answer.content}</p>
        </div>
      ))}
    </div>
  );

  const renderSplitView = () => (
    <div className="grid grid-cols-2 gap-4 h-96">
      {/* Answer Pane */}
      <div className="bg-gray-800 rounded-lg p-4 border border-gray-600 overflow-y-auto">
        <h3 className="text-green-400 mb-3">Answer</h3>
        <p className="text-white leading-relaxed">{answers[selectedAnswer].content}</p>
      </div>
      
      {/* Reasoning Pane */}
      <div className="bg-gray-800 rounded-lg p-4 border border-gray-600 overflow-y-auto">
        <h3 className="text-yellow-400 mb-3">Reasoning</h3>
        <p className="text-gray-300 text-sm leading-relaxed">
          {answers[selectedAnswer].reasoning || 'This answer was generated based on the context provided and trained knowledge patterns. The confidence score reflects the model\'s certainty in the response accuracy.'}
        </p>
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black bg-opacity-95 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
      <div className="bg-gray-900 rounded-lg p-6 border border-gray-700 neon-glow-intense max-w-4xl w-full max-h-[90vh] overflow-hidden glass-morphism">
        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <VideoHeader videoType="key" className="flex-1 h-16" />
          <Button
            onClick={onClose}
            variant="outline"
            size="sm"
            className="ml-4 border-red-500 text-red-400 hover:bg-red-950 neon-glow-pink"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Title and Question */}
        <div className="mb-6">
          <h2 className="text-2xl neon-text mb-3" style={{ fontFamily: 'Inter, sans-serif' }}>
            ZEPRA ANSWER
          </h2>
          <div className="bg-gray-800 rounded-lg p-4 border border-gray-600 mb-4">
            <span className="text-gray-400 text-sm">Question:</span>
            <p className="text-white mt-1">{question}</p>
          </div>
        </div>

        {/* View Mode Controls */}
        <div className="flex justify-between items-center mb-6">
          <div className="flex space-x-2">
            <Button
              onClick={() => setViewMode('single')}
              variant={viewMode === 'single' ? 'default' : 'outline'}
              size="sm"
              className={viewMode === 'single' ? 'bg-green-600 text-black neon-glow' : 'border-green-500 text-green-400'}
            >
              <MessageSquare className="w-4 h-4 mr-2" />
              Single
            </Button>
            <Button
              onClick={() => setViewMode('cards')}
              variant={viewMode === 'cards' ? 'default' : 'outline'}
              size="sm"
              className={viewMode === 'cards' ? 'bg-green-600 text-black neon-glow' : 'border-green-500 text-green-400'}
            >
              <Layout className="w-4 h-4 mr-2" />
              Cards
            </Button>
            <Button
              onClick={() => setViewMode('split')}
              variant={viewMode === 'split' ? 'default' : 'outline'}
              size="sm"
              className={viewMode === 'split' ? 'bg-green-600 text-black neon-glow' : 'border-green-500 text-green-400'}
            >
              <Maximize2 className="w-4 h-4 mr-2" />
              Split
            </Button>
          </div>
          
          <div className="flex space-x-2">
            <Button
              onClick={() => setViewMode('split')}
              variant="outline"
              size="sm"
              className="border-yellow-500 text-yellow-400 hover:bg-yellow-950 neon-glow-yellow"
            >
              <Eye className="w-4 h-4 mr-2" />
              Show Reasoning
            </Button>
          </div>
        </div>

        {/* Content Area */}
        <div className="mb-6">
          {viewMode === 'single' && renderSingleView()}
          {viewMode === 'cards' && renderCardsView()}
          {viewMode === 'split' && renderSplitView()}
        </div>

        {/* Action Buttons */}
        <div className="flex space-x-3">
          <Button
            onClick={copyAllAnswers}
            className="flex-1 bg-green-600 hover:bg-green-700 text-black neon-glow cyber-button"
          >
            <Copy className="w-4 h-4 mr-2" />
            COPY ALL ANSWERS
          </Button>
          <Button
            variant="outline"
            className="flex-1 border-yellow-500 text-yellow-400 hover:bg-yellow-950 neon-glow-yellow cyber-button"
          >
            <RotateCcw className="w-4 h-4 mr-2" />
            REGENERATE
          </Button>
        </div>
      </div>
    </div>
  );
}