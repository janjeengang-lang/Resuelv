import { useState } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { VideoHeader } from './VideoHeader';
import { ArrowLeft, TestTube } from 'lucide-react';

interface OptionsPageProps {
  onBack: () => void;
}

export function OptionsPage({ onBack }: OptionsPageProps) {
  const [primaryColor, setPrimaryColor] = useState('#00ff00');
  const [cerebrasKey, setCebrasKey] = useState('');
  const [ocrKey, setOcrKey] = useState('');
  const [ipdataKey, setIpdataKey] = useState('');
  const [model, setModel] = useState('llama-3.1-8b');
  const [typingSpeed, setTypingSpeed] = useState('normal');

  const testApiKey = (keyType: string) => {
    // Mock API test
    alert(`Testing ${keyType} API key...`);
  };

  return (
    <div className="min-h-screen bg-black text-white p-4 cyber-grid">
      <div className="max-w-md mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center space-x-4">
          <Button
            onClick={onBack}
            variant="outline"
            size="sm"
            className="border-green-500 text-green-400 hover:bg-green-950 neon-glow"
          >
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <h1 className="text-xl neon-text">Back to Dashboard</h1>
        </div>

        {/* Video Header */}
        <VideoHeader videoType="key" />
        
        {/* Zepra Options Title */}
        <div className="text-center">
          <h2 className="text-3xl neon-text mb-4" style={{ fontFamily: 'Inter, sans-serif' }}>
            ZEPRA OPTIONS
          </h2>
          <div className="h-px bg-gradient-to-r from-transparent via-green-500 to-transparent"></div>
        </div>

        {/* Theme Section */}
        <div className="bg-gray-900 rounded-lg p-4 border border-gray-700 neon-glow">
          <h3 className="text-lg mb-4 text-green-400">Theme</h3>
          <div className="space-y-2">
            <Label htmlFor="color-picker" className="text-white">Primary Neon Color</Label>
            <div className="flex space-x-2">
              <Input
                id="color-picker"
                type="color"
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
                className="w-16 h-10 p-1 bg-gray-800 border-gray-600"
              />
              <Input
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
                className="flex-1 bg-gray-800 border-gray-600 text-white"
              />
            </div>
          </div>
        </div>

        {/* API Keys Section */}
        <div className="bg-gray-900 rounded-lg p-4 border border-gray-700 neon-glow">
          <h3 className="text-lg mb-4 text-green-400">API Keys</h3>
          <div className="space-y-4">
            {/* Cerebras API */}
            <div className="space-y-2">
              <Label className="text-white">Cerebras API Key</Label>
              <div className="flex space-x-2">
                <Input
                  value={cerebrasKey}
                  onChange={(e) => setCebrasKey(e.target.value)}
                  type="password"
                  placeholder="Enter Cerebras API key"
                  className="flex-1 bg-gray-800 border-gray-600 text-white"
                />
                <Button
                  onClick={() => testApiKey('Cerebras')}
                  size="sm"
                  className="bg-yellow-500 hover:bg-yellow-600 text-black neon-glow-yellow"
                >
                  <TestTube className="w-4 h-4" />
                  Test
                </Button>
              </div>
            </div>

            {/* OCR.space API */}
            <div className="space-y-2">
              <Label className="text-white">OCR.space API Key</Label>
              <div className="flex space-x-2">
                <Input
                  value={ocrKey}
                  onChange={(e) => setOcrKey(e.target.value)}
                  type="password"
                  placeholder="Enter OCR.space API key"
                  className="flex-1 bg-gray-800 border-gray-600 text-white"
                />
                <Button
                  onClick={() => testApiKey('OCR.space')}
                  size="sm"
                  className="bg-yellow-500 hover:bg-yellow-600 text-black neon-glow-yellow"
                >
                  <TestTube className="w-4 h-4" />
                  Test
                </Button>
              </div>
            </div>

            {/* ipdata API */}
            <div className="space-y-2">
              <Label className="text-white">ipdata API Key</Label>
              <div className="flex space-x-2">
                <Input
                  value={ipdataKey}
                  onChange={(e) => setIpdataKey(e.target.value)}
                  type="password"
                  placeholder="Enter ipdata API key"
                  className="flex-1 bg-gray-800 border-gray-600 text-white"
                />
                <Button
                  onClick={() => testApiKey('ipdata')}
                  size="sm"
                  className="bg-yellow-500 hover:bg-yellow-600 text-black neon-glow-yellow"
                >
                  <TestTube className="w-4 h-4" />
                  Test
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* Model & Typing Section */}
        <div className="bg-gray-900 rounded-lg p-4 border border-gray-700 neon-glow">
          <h3 className="text-lg mb-4 text-green-400">Model & Typing</h3>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-white">Cerebras Model</Label>
              <Select value={model} onValueChange={setModel}>
                <SelectTrigger className="bg-gray-800 border-gray-600 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-gray-800 border-gray-600">
                  <SelectItem value="llama-3.1-8b">llama-3.1-8b</SelectItem>
                  <SelectItem value="llama-3.1-70b">llama-3.1-70b</SelectItem>
                  <SelectItem value="llama-3.2-3b">llama-3.2-3b</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-white">Typing Speed</Label>
              <Select value={typingSpeed} onValueChange={setTypingSpeed}>
                <SelectTrigger className="bg-gray-800 border-gray-600 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-gray-800 border-gray-600">
                  <SelectItem value="slow">Slow</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="fast">Fast</SelectItem>
                  <SelectItem value="instant">Instant</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {/* Save Button */}
        <Button className="w-full bg-green-500 hover:bg-green-600 text-black neon-glow text-lg py-3">
          SAVE SETTINGS
        </Button>
      </div>
    </div>
  );
}