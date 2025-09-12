import { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { VideoHeader } from './VideoHeader';
import { Loader2, Shield, Zap } from 'lucide-react';

interface LoginScreenProps {
  onLogin: (email: string, password: string) => void;
}

export function LoginScreen({ onLogin }: LoginScreenProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [loginState, setLoginState] = useState<'idle' | 'success' | 'error'>('idle');
  const [showWelcome, setShowWelcome] = useState(false);

  useEffect(() => {
    // Show welcome animation on mount
    setTimeout(() => setShowWelcome(true), 200);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError('Please fill in all fields');
      setLoginState('error');
      return;
    }
    
    setIsLoading(true);
    setError('');
    setLoginState('idle');
    
    // Simulate login process with visual feedback
    setTimeout(() => {
      setLoginState('success');
      setTimeout(() => {
        setIsLoading(false);
        onLogin(email, password);
      }, 1000);
    }, 1500);
  };

  return (
    <div className="min-h-screen bg-black text-white p-6 cyber-grid relative overflow-hidden">
      {/* Animated background elements */}
      <div className="absolute inset-0 opacity-20">
        <div className="absolute top-1/4 left-1/4 w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
        <div className="absolute top-3/4 right-1/4 w-1 h-1 bg-yellow-500 rounded-full animate-pulse delay-1000"></div>
        <div className="absolute bottom-1/4 left-3/4 w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse delay-500"></div>
      </div>

      <div className={`max-w-md mx-auto transition-all duration-1000 ${showWelcome ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}>
        {/* Video Header with state transitions */}
        <VideoHeader 
          videoType={loginState === 'success' ? 'zepra' : loginState === 'error' ? 'carry' : 'key'} 
          className="mb-8 transition-all duration-500" 
        />
        
        {/* Zepra Logo with enhanced effects */}
        <div className="text-center mb-8">
          <div className="relative inline-block">
            <h1 className="text-5xl neon-text-pulsating mb-2 tracking-wider" style={{ fontFamily: 'Inter, sans-serif' }}>
              ZEPRA
            </h1>
            <div className="absolute -inset-2 bg-gradient-to-r from-green-500/20 to-yellow-500/20 blur-xl -z-10"></div>
          </div>
          <div className="h-px bg-gradient-to-r from-transparent via-green-500 to-transparent mb-2"></div>
          <p className="text-sm text-gray-400 typing-animation max-w-xs mx-auto">
            Advanced Identity Management System
          </p>
        </div>

        {/* Login Form with enhanced styling */}
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="email" className="text-white flex items-center space-x-2">
              <Shield className="w-4 h-4 text-green-500" />
              <span>Email Address</span>
            </Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="bg-gray-900/80 border-gray-700 text-white focus:border-green-500 focus:ring-green-500 neon-glow glass-morphism h-12 transition-all duration-300"
              placeholder="Enter your secure email"
              disabled={isLoading}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password" className="text-white flex items-center space-x-2">
              <Zap className="w-4 h-4 text-yellow-500" />
              <span>Password</span>
            </Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="bg-gray-900/80 border-gray-700 text-white focus:border-green-500 focus:ring-green-500 neon-glow glass-morphism h-12 transition-all duration-300"
              placeholder="Enter your access key"
              disabled={isLoading}
            />
          </div>

          {error && (
            <div className="text-red-400 text-sm text-center p-3 border border-red-500 rounded-lg bg-red-950/20 neon-glow-pink animate-pulse">
              <div className="flex items-center justify-center space-x-2">
                <span className="w-2 h-2 bg-red-500 rounded-full"></span>
                <span>{error}</span>
              </div>
            </div>
          )}

          {loginState === 'success' && (
            <div className="text-green-400 text-sm text-center p-3 border border-green-500 rounded-lg bg-green-950/20 neon-glow animate-pulse">
              <div className="flex items-center justify-center space-x-2">
                <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                <span>Authentication successful! Initializing...</span>
              </div>
            </div>
          )}

          <Button 
            type="submit" 
            disabled={isLoading}
            className="w-full bg-green-500 hover:bg-green-600 text-black neon-glow-intense text-lg py-4 cyber-button relative overflow-hidden transition-all duration-300 disabled:opacity-50"
          >
            {isLoading ? (
              <div className="flex items-center justify-center space-x-2">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>AUTHENTICATING...</span>
              </div>
            ) : (
              <span className="tracking-wider">INITIALIZE SESSION</span>
            )}
          </Button>
        </form>

        {/* Security indicators */}
        <div className="mt-8 flex justify-center space-x-6 text-xs text-gray-500">
          <div className="flex items-center space-x-1">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
            <span>SECURE</span>
          </div>
          <div className="flex items-center space-x-1">
            <div className="w-2 h-2 bg-yellow-500 rounded-full animate-pulse delay-300"></div>
            <span>ENCRYPTED</span>
          </div>
          <div className="flex items-center space-x-1">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse delay-700"></div>
            <span>VERIFIED</span>
          </div>
        </div>
      </div>
    </div>
  );
}