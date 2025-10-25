import { useState } from 'react';
import { Button } from './ui/button';
import { VideoHeader } from './VideoHeader';
import { X, Copy, Zap, User, Building, MapPin, RefreshCw } from 'lucide-react';

interface GeneratedData {
  [key: string]: string;
}

interface GeneratorModalProps {
  type: 'fake-user' | 'real-address' | 'company-info';
  onClose: () => void;
}

export function GeneratorModal({ type, onClose }: GeneratorModalProps) {
  const [generatedData, setGeneratedData] = useState<GeneratedData | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const getModalTitle = () => {
    switch (type) {
      case 'fake-user': return 'FAKE USER GENERATOR';
      case 'real-address': return 'REAL ADDRESS GENERATOR';
      case 'company-info': return 'COMPANY INFO GENERATOR';
      default: return 'DATA GENERATOR';
    }
  };

  const getIcon = () => {
    switch (type) {
      case 'fake-user': return User;
      case 'real-address': return MapPin;
      case 'company-info': return Building;
      default: return Zap;
    }
  };

  const generateMockData = () => {
    setIsGenerating(true);
    
    setTimeout(() => {
      let mockData: GeneratedData = {};
      
      switch (type) {
        case 'fake-user':
          mockData = {
            'Full Name': 'Alexandra Thompson',
            'Email': 'alexandra.thompson@protonmail.com',
            'Phone': '+1 (555) 0198-4567',
            'Date of Birth': 'March 15, 1988',
            'Social Security': '***-**-4892',
            'Username': 'alex_thompson_88'
          };
          break;
        case 'real-address':
          mockData = {
            'Street Address': '1247 Maple Street',
            'City': 'San Francisco',
            'State': 'California',
            'ZIP Code': '94102',
            'Country': 'United States',
            'Coordinates': '37.7749, -122.4194'
          };
          break;
        case 'company-info':
          mockData = {
            'Company Name': 'NeoTech Solutions LLC',
            'Industry': 'Software Development',
            'Founded': '2019',
            'Employees': '25-50',
            'Revenue': '$2.5M - $5M',
            'Website': 'neotech-solutions.com'
          };
          break;
      }
      
      setGeneratedData(mockData);
      setIsGenerating(false);
    }, 2000);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const copyAllData = () => {
    if (generatedData) {
      const allData = Object.entries(generatedData)
        .map(([key, value]) => `${key}: ${value}`)
        .join('\n');
      navigator.clipboard.writeText(allData);
    }
  };

  const IconComponent = getIcon();

  return (
    <div className="fixed inset-0 bg-black bg-opacity-95 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
      <div className="bg-gray-900 rounded-lg p-6 border border-gray-700 neon-glow max-w-lg w-full max-h-[90vh] overflow-y-auto glass-morphism">
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
        <div className="text-center mb-6">
          <div className="flex items-center justify-center space-x-3 mb-3">
            <IconComponent className="w-8 h-8 text-green-500" />
            <h2 className="text-2xl neon-text" style={{ fontFamily: 'Inter, sans-serif' }}>
              {getModalTitle()}
            </h2>
          </div>
          <div className="h-px bg-gradient-to-r from-transparent via-green-500 to-transparent"></div>
        </div>

        {/* Generate Button */}
        {!generatedData && (
          <div className="text-center mb-6">
            <Button
              onClick={generateMockData}
              disabled={isGenerating}
              className="bg-green-500 hover:bg-green-600 text-black neon-glow-intense px-8 py-4 cyber-button"
            >
              {isGenerating ? (
                <div className="flex items-center space-x-2">
                  <RefreshCw className="w-5 h-5 animate-spin" />
                  <span>GENERATING...</span>
                </div>
              ) : (
                <div className="flex items-center space-x-2">
                  <Zap className="w-5 h-5" />
                  <span>GENERATE DATA</span>
                </div>
              )}
            </Button>
          </div>
        )}

        {/* Generated Data Cards */}
        {generatedData && (
          <div className="space-y-4">
            {Object.entries(generatedData).map(([key, value], index) => (
              <div 
                key={index}
                className="bg-gray-800 rounded-lg p-4 border border-gray-600 data-card"
              >
                <div className="flex justify-between items-center">
                  <div className="flex-1">
                    <label className="text-sm text-green-400 mb-1 block">{key}</label>
                    <p className="text-white text-lg">{value}</p>
                  </div>
                  <div className="flex space-x-2 ml-4">
                    <Button
                      onClick={() => copyToClipboard(value)}
                      size="sm"
                      variant="outline"
                      className="border-green-500 text-green-400 hover:bg-green-950 neon-glow cyber-button"
                    >
                      <Copy className="w-4 h-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-yellow-500 text-yellow-400 hover:bg-yellow-950 neon-glow-yellow cyber-button"
                    >
                      ATI
                    </Button>
                  </div>
                </div>
              </div>
            ))}

            {/* Action Buttons */}
            <div className="flex space-x-3 pt-4">
              <Button
                onClick={copyAllData}
                className="flex-1 bg-green-600 hover:bg-green-700 text-black neon-glow cyber-button"
              >
                <Copy className="w-4 h-4 mr-2" />
                COPY ALL
              </Button>
              <Button
                onClick={() => setGeneratedData(null)}
                variant="outline"
                className="flex-1 border-yellow-500 text-yellow-400 hover:bg-yellow-950 neon-glow-yellow cyber-button"
              >
                <RefreshCw className="w-4 h-4 mr-2" />
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