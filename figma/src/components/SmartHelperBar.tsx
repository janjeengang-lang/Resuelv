import { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { X, Zap, Eye, Settings } from 'lucide-react';

interface SmartHelperBarProps {
  isVisible: boolean;
  onClose: () => void;
  onFillForm: () => void;
  detectedFields?: string[];
}

export function SmartHelperBar({ 
  isVisible, 
  onClose, 
  onFillForm, 
  detectedFields = [] 
}: SmartHelperBarProps) {
  const [isAnimating, setIsAnimating] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);

  useEffect(() => {
    if (isVisible) {
      setIsAnimating(true);
      // Simulate form scanning
      const interval = setInterval(() => {
        setScanProgress(prev => {
          if (prev >= 100) {
            clearInterval(interval);
            return 100;
          }
          return prev + 20;
        });
      }, 200);
    } else {
      setScanProgress(0);
    }
  }, [isVisible]);

  if (!isVisible) return null;

  return (
    <div className={`fixed top-0 left-0 right-0 z-50 transform transition-all duration-500 ${
      isAnimating ? 'translate-y-0' : '-translate-y-full'
    }`}>
      <div className="bg-gray-900 border-b-2 border-green-500 neon-glow glass-morphism">
        <div className="max-w-4xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            {/* Left Section - Status */}
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 rounded-full border-2 border-green-500 flex items-center justify-center neon-glow">
                  <Zap className="w-4 h-4 text-green-500" />
                </div>
                <div>
                  <div className="text-green-400 text-sm">ZEPRA AUTO-PILOT</div>
                  <div className="text-xs text-gray-400">
                    {scanProgress < 100 ? `Scanning form... ${scanProgress}%` : 'Form analysis complete'}
                  </div>
                </div>
              </div>

              {/* Progress Bar */}
              <div className="w-32 h-1 bg-gray-700 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-green-500 transition-all duration-300 neon-glow"
                  style={{ width: `${scanProgress}%` }}
                ></div>
              </div>
            </div>

            {/* Center Section - Detected Fields */}
            <div className="flex items-center space-x-4">
              {detectedFields.length > 0 && (
                <div className="flex items-center space-x-2">
                  <Eye className="w-4 h-4 text-yellow-500" />
                  <span className="text-yellow-400 text-sm">
                    {detectedFields.length} fields detected
                  </span>
                </div>
              )}
            </div>

            {/* Right Section - Actions */}
            <div className="flex items-center space-x-3">
              <Button
                onClick={onFillForm}
                disabled={scanProgress < 100}
                className="bg-green-500 hover:bg-green-600 text-black neon-glow cyber-button px-6"
              >
                <Zap className="w-4 h-4 mr-2" />
                FILL FORM
              </Button>
              
              <Button
                variant="outline"
                size="sm"
                className="border-gray-600 text-gray-400 hover:bg-gray-800"
              >
                <Settings className="w-4 h-4" />
              </Button>

              <Button
                onClick={onClose}
                variant="outline"
                size="sm"
                className="border-red-500 text-red-400 hover:bg-red-950 neon-glow-pink"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Detected Fields List */}
          {detectedFields.length > 0 && scanProgress >= 100 && (
            <div className="mt-3 pt-3 border-t border-gray-700">
              <div className="flex flex-wrap gap-2">
                {detectedFields.map((field, index) => (
                  <span
                    key={index}
                    className="px-3 py-1 bg-gray-800 border border-green-500 rounded-full text-xs text-green-400 neon-glow"
                  >
                    {field}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Animated border */}
        <div className="h-px bg-gradient-to-r from-transparent via-green-500 to-transparent animate-pulse"></div>
      </div>
    </div>
  );
}