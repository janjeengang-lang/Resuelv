import { useState } from 'react';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { VideoHeader } from './VideoHeader';
import { Clock, Copy, RotateCcw, MessageSquare, Scale, FolderOpen } from 'lucide-react';

interface DashboardProps {
  userEmail: string;
  onLogout: () => void;
  onNavigate: (screen: string) => void;
}

export function Dashboard({ userEmail, onLogout, onNavigate }: DashboardProps) {
  const [sessionTime, setSessionTime] = useState('00:12:34');
  const [textContent, setTextContent] = useState('');

  const navButtons = [
    { icon: FolderOpen, label: 'Open', action: () => {} },
    { icon: MessageSquare, label: 'MCQ', action: () => {} },
    { icon: Scale, label: 'Scale', action: () => {} },
  ];

  return (
    <div className="min-h-screen bg-black text-white p-4 cyber-grid">
      <div className="max-w-md mx-auto space-y-4">
        {/* Video Header */}
        <VideoHeader videoType="key" />
        
        {/* User Info */}
        <div className="flex justify-between items-center bg-gray-900 rounded-lg p-3 border border-gray-700 neon-glow">
          <span className="text-sm text-gray-300">{userEmail}</span>
          <Button 
            onClick={onLogout}
            variant="outline"
            size="sm"
            className="border-red-500 text-red-400 hover:bg-red-950 neon-glow-pink"
          >
            Logout
          </Button>
        </div>

        {/* Session Timer */}
        <div className="bg-gray-900 rounded-lg p-4 border border-gray-700 neon-glow">
          <div className="flex items-center justify-center space-x-2">
            <Clock className="w-5 h-5 text-green-500" />
            <span className="text-xl neon-text">{sessionTime}</span>
          </div>
        </div>

        {/* Navigation Buttons */}
        <div className="flex space-x-2">
          {navButtons.map((button, index) => (
            <Button
              key={index}
              onClick={button.action}
              className="flex-1 bg-gray-900 border border-gray-700 text-white hover:bg-gray-800 neon-glow flex flex-col items-center py-4 space-y-1"
            >
              <button.icon className="w-6 h-6 text-green-500" />
              <span className="text-xs">{button.label}</span>
            </Button>
          ))}
        </div>

        {/* Preview Area */}
        <div className="space-y-2">
          <Textarea
            value={textContent}
            onChange={(e) => setTextContent(e.target.value)}
            placeholder="Preview area..."
            className="min-h-32 bg-gray-900 border-gray-700 text-white resize-none neon-glow"
          />
        </div>

        {/* Action Buttons */}
        <div className="grid grid-cols-3 gap-2">
          <Button 
            className="bg-gray-900 border border-gray-700 text-white hover:bg-gray-800 neon-glow"
            onClick={() => setTextContent('')}
          >
            Write Here
          </Button>
          <Button 
            className="bg-green-600 hover:bg-green-700 text-black neon-glow"
            onClick={() => navigator.clipboard.writeText(textContent)}
          >
            <Copy className="w-4 h-4 mr-2" />
            Copy
          </Button>
          <Button 
            className="bg-yellow-500 hover:bg-yellow-600 text-black neon-glow-yellow"
            onClick={() => setTextContent('')}
          >
            <RotateCcw className="w-4 h-4 mr-2" />
            Reset
          </Button>
        </div>

        {/* Navigation Links */}
        <div className="grid grid-cols-2 gap-2 pt-4">
          <Button 
            onClick={() => onNavigate('options')}
            variant="outline"
            className="border-green-500 text-green-400 hover:bg-green-950 neon-glow"
          >
            Options
          </Button>
          <Button 
            onClick={() => onNavigate('identities')}
            variant="outline"
            className="border-green-500 text-green-400 hover:bg-green-950 neon-glow"
          >
            Identities
          </Button>
        </div>
      </div>
    </div>
  );
}