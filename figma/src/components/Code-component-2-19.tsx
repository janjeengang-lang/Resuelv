import { useState } from 'react';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { VideoHeader } from './VideoHeader';
import { X, Sparkles, Loader2, User, MapPin, Building } from 'lucide-react';

interface CreateWithAIModalProps {
  onClose: () => void;
  onIdentityCreated?: (identity: any) => void;
}

export function CreateWithAIModal({ onClose, onIdentityCreated }: CreateWithAIModalProps) {
  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedIdentity, setGeneratedIdentity] = useState<any>(null);

  const quickPrompts = [
    {
      icon: User,
      label: "Tech Professional",
      prompt: "Create a software engineer identity based in Silicon Valley, age 28-35, with startup experience"
    },
    {
      icon: MapPin,
      label: "European Citizen",
      prompt: "Generate a European identity from Germany or Netherlands, freelancer, age 25-40"
    },
    {
      icon: Building,
      label: "Business Executive",
      prompt: "Create a business executive identity, Fortune 500 company, age 35-50, MBA background"
    }
  ];

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    
    setIsGenerating(true);
    
    // Simulate AI generation
    setTimeout(() => {
      const mockIdentity = {
        fullName: 'Marcus Chen',
        email: 'marcus.chen@techcorp.com',
        phone: '+1 (555) 0147-8923',
        address: '2847 Innovation Drive',
        city: 'Palo Alto',
        state: 'California',
        country: 'United States',
        age: 32,
        occupation: 'Senior Software Engineer',
        company: 'TechCorp Solutions',
        background: 'Stanford Computer Science graduate with 8 years of experience in full-stack development and team leadership.'
      };
      
      setGeneratedIdentity(mockIdentity);
      setIsGenerating(false);
    }, 3000);
  };

  const handleSaveIdentity = () => {
    if (generatedIdentity && onIdentityCreated) {
      onIdentityCreated(generatedIdentity);
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-95 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
      <div className="bg-gray-900 rounded-lg p-6 border border-gray-700 neon-glow-intense max-w-2xl w-full max-h-[90vh] overflow-y-auto glass-morphism">
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

        {/* Title */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center space-x-3 mb-3">
            <Sparkles className="w-8 h-8 text-yellow-500 animate-pulse" />
            <h2 className="text-3xl neon-text-yellow" style={{ fontFamily: 'Inter, sans-serif' }}>
              AI IDENTITY CREATOR
            </h2>
          </div>
          <div className="h-px bg-gradient-to-r from-transparent via-yellow-500 to-transparent mb-4"></div>
          <p className="text-gray-400 text-sm">
            Describe the type of identity you need and let our AI create a complete profile
          </p>
        </div>

        {!generatedIdentity ? (
          <>
            {/* Quick Prompts */}
            <div className="mb-6">
              <h3 className="text-lg text-green-400 mb-3">Quick Templates</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {quickPrompts.map((template, index) => (
                  <Button
                    key={index}
                    onClick={() => setPrompt(template.prompt)}
                    variant="outline"
                    className="border-gray-600 text-left p-4 h-auto hover:border-green-500 hover:bg-green-950/20 data-card"
                  >
                    <div className="flex items-start space-x-3">
                      <template.icon className="w-5 h-5 text-green-500 mt-1" />
                      <div>
                        <div className="text-white text-sm mb-1">{template.label}</div>
                        <div className="text-gray-400 text-xs">{template.prompt.substring(0, 50)}...</div>
                      </div>
                    </div>
                  </Button>
                ))}
              </div>
            </div>

            {/* Prompt Input */}
            <div className="mb-6">
              <label className="text-green-400 text-lg mb-3 block">Describe Your Identity</label>
              <Textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Example: Create a marketing professional identity from Toronto, Canada, age 29, with experience in digital advertising and social media management..."
                className="min-h-32 bg-gray-800 border-gray-600 text-white resize-none neon-glow glass-morphism"
                disabled={isGenerating}
              />
            </div>

            {/* Generate Button */}
            <Button
              onClick={handleGenerate}
              disabled={isGenerating || !prompt.trim()}
              className="w-full bg-yellow-500 hover:bg-yellow-600 text-black neon-glow-yellow cyber-button text-lg py-4"
            >
              {isGenerating ? (
                <div className="flex items-center justify-center space-x-2">
                  <Loader2 className="w-6 h-6 animate-spin" />
                  <span>GENERATING IDENTITY...</span>
                </div>
              ) : (
                <div className="flex items-center justify-center space-x-2">
                  <Sparkles className="w-6 h-6" />
                  <span>GENERATE WITH AI</span>
                </div>
              )}
            </Button>
          </>
        ) : (
          /* Generated Identity Display */
          <div className="space-y-4">
            <h3 className="text-xl text-green-400 mb-4">Generated Identity</h3>
            
            {/* Identity Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {Object.entries(generatedIdentity).map(([key, value], index) => (
                <div 
                  key={index}
                  className="bg-gray-800 rounded-lg p-4 border border-gray-600 data-card"
                >
                  <label className="text-sm text-green-400 mb-1 block capitalize">
                    {key.replace(/([A-Z])/g, ' $1').trim()}
                  </label>
                  <p className="text-white">{value as string}</p>
                </div>
              ))}
            </div>

            {/* Action Buttons */}
            <div className="flex space-x-3 pt-6">
              <Button
                onClick={handleSaveIdentity}
                className="flex-1 bg-green-500 hover:bg-green-600 text-black neon-glow-intense cyber-button"
              >
                <User className="w-4 h-4 mr-2" />
                SAVE IDENTITY
              </Button>
              <Button
                onClick={() => setGeneratedIdentity(null)}
                variant="outline"
                className="flex-1 border-yellow-500 text-yellow-400 hover:bg-yellow-950 neon-glow-yellow cyber-button"
              >
                <Sparkles className="w-4 h-4 mr-2" />
                REGENERATE
              </Button>
            </div>
          </div>
        )}

        {/* Close Button */}
        <Button 
          onClick={onClose}
          className="w-full mt-6 bg-gray-700 hover:bg-gray-600 text-white border border-gray-600"
        >
          CLOSE
        </Button>
      </div>
    </div>
  );
}