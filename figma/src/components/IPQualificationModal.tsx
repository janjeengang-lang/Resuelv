import { Button } from './ui/button';
import { VideoHeader } from './VideoHeader';
import { X, CheckCircle, XCircle, Shield, Eye, AlertTriangle } from 'lucide-react';

interface IPQualificationModalProps {
  isQualified: boolean;
  score: number;
  ipAddress: string;
  isp: string;
  onClose: () => void;
}

export function IPQualificationModal({ 
  isQualified, 
  score, 
  ipAddress, 
  isp, 
  onClose 
}: IPQualificationModalProps) {
  const checks = [
    { 
      label: 'Risk Score', 
      icon: Shield, 
      passed: score < 50,
      value: `${score}/100`
    },
    { 
      label: 'Blacklist Check', 
      icon: AlertTriangle, 
      passed: true,
      value: 'Clean'
    },
    { 
      label: 'Anonymity Check', 
      icon: Eye, 
      passed: !isQualified,
      value: isQualified ? 'Residential' : 'VPN/Proxy'
    },
  ];

  return (
    <div className="fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center p-4 z-50">
      <div className="bg-gray-900 rounded-lg p-6 border border-gray-700 neon-glow max-w-md w-full">
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

        {/* Qualification Status Circle */}
        <div className="flex justify-center mb-6">
          <div className="relative">
            {/* Circular Video Frame */}
            <div className="w-32 h-32 rounded-full border-4 border-green-500 neon-glow overflow-hidden">
              <div className="video-placeholder w-full h-full rounded-full">
                <div className="text-center">
                  <div className="text-xs opacity-75 mb-1">VIDEO</div>
                  <div className="text-xs">
                    {isQualified ? 'zepra.webm' : 'carry.webm'}
                  </div>
                </div>
              </div>
            </div>
            
            {/* Overlay Status */}
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <div className={`text-2xl mb-1 ${isQualified ? 'text-green-400 neon-text' : 'text-red-400'}`}>
                {isQualified ? 'QUALIFIED' : 'NOT QUALIFIED'}
              </div>
              <div className="text-lg text-white">{score}</div>
            </div>
          </div>
        </div>

        {/* Checks List */}
        <div className="space-y-3 mb-6">
          {checks.map((check, index) => (
            <div key={index} className="bg-gray-800 rounded-lg p-3 border border-gray-600">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <check.icon className={`w-5 h-5 ${check.passed ? 'text-green-400' : 'text-red-400'}`} />
                  <span className="text-white">{check.label}</span>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="text-gray-300 text-sm">{check.value}</span>
                  {check.passed ? (
                    <CheckCircle className="w-4 h-4 text-green-400" />
                  ) : (
                    <XCircle className="w-4 h-4 text-red-400" />
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* IP Information */}
        <div className="bg-gray-800 rounded-lg p-4 border border-gray-600 mb-6">
          <h3 className="text-green-400 mb-3">IP Information</h3>
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-gray-400">IP Address:</span>
              <span className="text-white">{ipAddress}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">ISP:</span>
              <span className="text-white">{isp}</span>
            </div>
          </div>
        </div>

        {/* Close Button */}
        <Button 
          onClick={onClose}
          className="w-full bg-green-500 hover:bg-green-600 text-black neon-glow"
        >
          CLOSE
        </Button>
      </div>
    </div>
  );
}