import { Button } from './ui/button';
import { VideoHeader } from './VideoHeader';
import { X, Copy } from 'lucide-react';

interface Identity {
  id: string;
  name: string;
  country: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
}

interface ShowIdentityModalProps {
  identity: Identity;
  onClose: () => void;
}

export function ShowIdentityModal({ identity, onClose }: ShowIdentityModalProps) {
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const identityData = [
    { label: 'Full Name', value: identity.name || 'John Smith' },
    { label: 'Email', value: identity.email || 'john.smith@example.com' },
    { label: 'Phone', value: identity.phone || '+1 (555) 123-4567' },
    { label: 'Address', value: identity.address || '123 Main Street' },
    { label: 'City', value: identity.city || 'New York' },
    { label: 'Country', value: identity.country },
  ];

  return (
    <div className="fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center p-4 z-50">
      {/* Full Modal Background Video */}
      <div className="absolute inset-0 opacity-20">
        <div className="video-placeholder w-full h-full rounded-none">
          <div className="text-center">
            <div className="text-2xl opacity-75 mb-2">VIDEO BACKGROUND</div>
            <div className="text-lg">cepra.webm</div>
          </div>
        </div>
      </div>
      
      <div className="bg-gray-900 rounded-lg p-6 border border-gray-700 neon-glow max-w-md w-full relative z-10">
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
          <h2 className="text-2xl neon-text" style={{ fontFamily: 'Inter, sans-serif' }}>
            IDENTITY DATA
          </h2>
          <div className="h-px bg-gradient-to-r from-transparent via-green-500 to-transparent mt-2"></div>
        </div>

        {/* Identity Data */}
        <div className="space-y-4">
          {identityData.map((item, index) => (
            <div key={index} className="bg-gray-800 rounded-lg p-3 border border-gray-600">
              <div className="flex justify-between items-center">
                <div>
                  <label className="text-sm text-gray-400">{item.label}</label>
                  <p className="text-white">{item.value}</p>
                </div>
                <Button
                  onClick={() => copyToClipboard(item.value)}
                  size="sm"
                  variant="outline"
                  className="border-green-500 text-green-400 hover:bg-green-950 neon-glow"
                >
                  <Copy className="w-4 h-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>

        {/* Close Button */}
        <Button 
          onClick={onClose}
          className="w-full mt-6 bg-green-500 hover:bg-green-600 text-black neon-glow"
        >
          CLOSE
        </Button>
      </div>
    </div>
  );
}