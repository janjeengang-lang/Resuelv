import { useState } from 'react';
import { Button } from './ui/button';
import { Switch } from './ui/switch';
import { VideoHeader } from './VideoHeader';
import { ArrowLeft, Plus, Sparkles, Edit, Trash2, Power, PowerOff, Globe, Shield, Eye } from 'lucide-react';

interface Identity {
  id: string;
  name: string;
  country: string;
  isActive: boolean;
  useProxy: boolean;
  occupation?: string;
  trustScore: number;
}

interface IdentitiesDashboardProps {
  onBack: () => void;
  onShowModal: (modalType: string, data?: any) => void;
}

export function IdentitiesDashboard({ onBack, onShowModal }: IdentitiesDashboardProps) {
  const [identities, setIdentities] = useState<Identity[]>([
    { 
      id: '1', 
      name: 'Marcus Chen', 
      country: 'United States', 
      isActive: true, 
      useProxy: true, 
      occupation: 'Software Engineer',
      trustScore: 92
    },
    { 
      id: '2', 
      name: 'Emma Wilson', 
      country: 'United Kingdom', 
      isActive: false, 
      useProxy: false, 
      occupation: 'Marketing Manager',
      trustScore: 87
    },
    { 
      id: '3', 
      name: 'Carlos Rodriguez', 
      country: 'Spain', 
      isActive: false, 
      useProxy: true, 
      occupation: 'Data Analyst',
      trustScore: 95
    },
  ]);

  const toggleIdentityActive = (id: string) => {
    setIdentities(prev => prev.map(identity => 
      identity.id === id 
        ? { ...identity, isActive: !identity.isActive }
        : { ...identity, isActive: false } // Only one can be active
    ));
  };

  const toggleProxy = (id: string) => {
    setIdentities(prev => prev.map(identity => 
      identity.id === id 
        ? { ...identity, useProxy: !identity.useProxy }
        : identity
    ));
  };

  return (
    <div className="min-h-screen bg-black text-white p-4 cyber-grid relative overflow-hidden">
      {/* Enhanced Background Video Area with overlay effects */}
      <div className="absolute inset-0 opacity-15">
        <VideoHeader videoType="key" className="w-full h-full rounded-none border-none" />
        <div className="absolute inset-0 bg-gradient-to-br from-green-500/5 to-yellow-500/5"></div>
      </div>
      
      <div className="max-w-2xl mx-auto space-y-6 relative z-10">
        {/* Enhanced Header */}
        <div className="flex items-center justify-between bg-gray-900/80 rounded-lg p-4 border border-gray-700 neon-glow glass-morphism">
          <div className="flex items-center space-x-4">
            <Button
              onClick={onBack}
              variant="outline"
              size="sm"
              className="border-green-500 text-green-400 hover:bg-green-950 neon-glow cyber-button"
            >
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <h1 className="text-xl neon-text">Identity Management</h1>
          </div>
          <div className="flex items-center space-x-2 text-sm text-gray-400">
            <Shield className="w-4 h-4 text-green-500" />
            <span>{identities.filter(i => i.isActive).length} Active</span>
          </div>
        </div>

        {/* Video Header */}
        <VideoHeader videoType="key" className="neon-glow-intense" />
        
        {/* Enhanced Title Section */}
        <div className="text-center glass-morphism rounded-lg p-6 border border-gray-700 neon-glow">
          <h2 className="text-4xl neon-text-pulsating mb-4" style={{ fontFamily: 'Inter, sans-serif' }}>
            IDENTITY HUB
          </h2>
          <div className="h-px bg-gradient-to-r from-transparent via-green-500 to-transparent mb-4"></div>
          <p className="text-gray-400 text-sm">
            Manage your digital personas with advanced AI-generated profiles
          </p>
        </div>

        {/* Enhanced Create Buttons */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Button 
            className="bg-green-600 hover:bg-green-700 text-black neon-glow-intense cyber-button py-6 relative overflow-hidden group"
            onClick={() => onShowModal('createIdentity')}
          >
            <div className="flex items-center justify-center space-x-3">
              <Plus className="w-6 h-6" />
              <div className="text-left">
                <div className="text-lg">Create New Identity</div>
                <div className="text-xs opacity-80">Manual profile creation</div>
              </div>
            </div>
          </Button>
          <Button 
            className="bg-yellow-500 hover:bg-yellow-600 text-black neon-glow-yellow cyber-button py-6 relative overflow-hidden group"
            onClick={() => onShowModal('createWithAI')}
          >
            <div className="flex items-center justify-center space-x-3">
              <Sparkles className="w-6 h-6 animate-pulse" />
              <div className="text-left">
                <div className="text-lg">Create with AI</div>
                <div className="text-xs opacity-80">AI-powered generation</div>
              </div>
            </div>
          </Button>
        </div>

        {/* Enhanced Identity Cards */}
        <div className="space-y-6">
          {identities.map((identity) => (
            <div 
              key={identity.id}
              className={`bg-gray-900/90 rounded-lg p-6 border-2 transition-all duration-300 glass-morphism data-card ${
                identity.isActive 
                  ? 'border-green-500 neon-glow-pulsating' 
                  : 'border-gray-700 neon-glow hover:border-green-400'
              }`}
            >
              <div className="flex items-start space-x-6">
                {/* Enhanced Profile Video Circle */}
                <div className="relative">
                  <div className={`w-20 h-20 rounded-full border-3 overflow-hidden transition-all duration-300 ${
                    identity.isActive 
                      ? 'border-green-500 neon-glow-intense' 
                      : 'border-gray-500 neon-glow'
                  }`}>
                    <div className="video-placeholder w-full h-full rounded-full text-xs bg-gradient-to-br from-gray-800 to-gray-900">
                      <div className="flex flex-col items-center justify-center h-full">
                        <div className="text-xs opacity-75 mb-1">VIDEO</div>
                        <div className="text-xs">zepra.webm</div>
                      </div>
                    </div>
                  </div>
                  {identity.isActive && (
                    <div className="absolute -top-1 -right-1 w-6 h-6 bg-green-500 rounded-full flex items-center justify-center neon-glow status-active">
                      <div className="w-2 h-2 bg-black rounded-full"></div>
                    </div>
                  )}
                </div>
                
                {/* Enhanced Identity Info */}
                <div className="flex-1">
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <h3 className="text-xl text-white mb-1">{identity.name}</h3>
                      <p className="text-gray-400 text-sm mb-1">{identity.occupation}</p>
                      <div className="flex items-center space-x-3 text-sm">
                        <div className="flex items-center space-x-1">
                          <Globe className="w-3 h-3 text-blue-400" />
                          <span className="text-gray-400">{identity.country}</span>
                        </div>
                        <div className="flex items-center space-x-1">
                          <Shield className="w-3 h-3 text-green-400" />
                          <span className="text-green-400">{identity.trustScore}% Trust</span>
                        </div>
                      </div>
                    </div>
                    
                    {/* Status Badge */}
                    <div className={`px-3 py-1 rounded-full text-xs border ${
                      identity.isActive 
                        ? 'bg-green-500/20 border-green-500 text-green-400' 
                        : 'bg-gray-500/20 border-gray-500 text-gray-400'
                    }`}>
                      {identity.isActive ? 'ACTIVE' : 'STANDBY'}
                    </div>
                  </div>

                  {/* Proxy Toggle */}
                  <div className="flex items-center justify-between bg-gray-800 rounded-lg p-3 mb-4 border border-gray-600">
                    <div className="flex items-center space-x-2">
                      <Eye className="w-4 h-4 text-gray-400" />
                      <span className="text-sm text-white">Use Proxy</span>
                    </div>
                    <Switch
                      checked={identity.useProxy}
                      onCheckedChange={() => toggleProxy(identity.id)}
                      className="data-[state=checked]:bg-green-500"
                    />
                  </div>

                  {/* Enhanced Action Buttons */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <Button
                      size="sm"
                      className={`cyber-button transition-all duration-300 ${identity.isActive 
                        ? 'bg-red-600 hover:bg-red-700 neon-glow-pink text-white' 
                        : 'bg-green-600 hover:bg-green-700 neon-glow text-black'
                      }`}
                      onClick={() => toggleIdentityActive(identity.id)}
                    >
                      {identity.isActive ? (
                        <>
                          <PowerOff className="w-4 h-4 mr-1" />
                          Deactivate
                        </>
                      ) : (
                        <>
                          <Power className="w-4 h-4 mr-1" />
                          Activate
                        </>
                      )}
                    </Button>
                    
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-blue-500 text-blue-400 hover:bg-blue-950/50 cyber-button neon-glow"
                      onClick={() => onShowModal('showIdentity', identity)}
                    >
                      <Eye className="w-4 h-4 mr-1" />
                      View
                    </Button>
                    
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-yellow-500 text-yellow-400 hover:bg-yellow-950/50 neon-glow-yellow cyber-button"
                      onClick={() => {}}
                    >
                      <Edit className="w-4 h-4 mr-1" />
                      Edit
                    </Button>
                    
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-red-500 text-red-400 hover:bg-red-950/50 neon-glow-pink cyber-button"
                      onClick={() => {}}
                    >
                      <Trash2 className="w-4 h-4 mr-1" />
                      Delete
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Quick Action Bar */}
        <div className="bg-gray-900/80 rounded-lg p-4 border border-gray-700 neon-glow glass-morphism">
          <div className="flex justify-between items-center">
            <div className="text-sm text-gray-400">
              Quick Actions
            </div>
            <div className="flex space-x-2">
              <Button
                size="sm"
                variant="outline"
                className="border-green-500 text-green-400 hover:bg-green-950 cyber-button"
                onClick={() => onShowModal('fakeUser')}
              >
                Generate User
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="border-yellow-500 text-yellow-400 hover:bg-yellow-950 cyber-button"
                onClick={() => onShowModal('realAddress')}
              >
                Real Address
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="border-blue-500 text-blue-400 hover:bg-blue-950 cyber-button"
                onClick={() => onShowModal('companyInfo')}
              >
                Company Info
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}