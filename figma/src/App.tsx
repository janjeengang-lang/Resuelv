import { useState } from 'react';
import { LoginScreen } from './components/LoginScreen';
import { Dashboard } from './components/Dashboard';
import { OptionsPage } from './components/OptionsPage';
import { IdentitiesDashboard } from './components/IdentitiesDashboard';
import { ShowIdentityModal } from './components/ShowIdentityModal';
import { IPQualificationModal } from './components/IPQualificationModal';
import { GeneratorModal } from './components/GeneratorModal';
import { CreateWithAIModal } from './components/CreateWithAIModal';
import { ZepraAnswerModal } from './components/ZepraAnswerModal';
import { SmartHelperBar } from './components/SmartHelperBar';
import { FloatingBubble } from './components/FloatingBubble';

type Screen = 'login' | 'dashboard' | 'options' | 'identities';
type Modal = 'none' | 'showIdentity' | 'ipQualification' | 'createIdentity' | 'createWithAI' | 'fakeUser' | 'realAddress' | 'companyInfo' | 'zepraAnswer';

interface User {
  email: string;
  isLoggedIn: boolean;
}

interface Identity {
  id: string;
  name: string;
  country: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
}

interface Answer {
  id: string;
  title: string;
  content: string;
  reasoning?: string;
  confidence: number;
}

export default function App() {
  const [currentScreen, setCurrentScreen] = useState<Screen>('login');
  const [currentModal, setCurrentModal] = useState<Modal>('none');
  const [user, setUser] = useState<User>({ email: '', isLoggedIn: false });
  const [selectedIdentity, setSelectedIdentity] = useState<Identity | null>(null);
  const [showHelperBar, setShowHelperBar] = useState(false);
  
  // Mock answers for demo
  const mockAnswers: Answer[] = [
    {
      id: '1',
      title: 'Primary Answer',
      content: 'Based on current market trends and user behavior analysis, implementing a microservices architecture would provide the best scalability and maintainability for your application.',
      reasoning: 'This recommendation is based on industry best practices, scalability requirements, and long-term maintenance considerations.',
      confidence: 92
    },
    {
      id: '2',
      title: 'Alternative Approach',
      content: 'A monolithic architecture with proper modularization could also work well for your current scale, offering simpler deployment and debugging.',
      reasoning: 'For smaller teams and simpler deployment requirements, monolithic architecture can be more efficient.',
      confidence: 78
    }
  ];

  const handleLogin = (email: string, password: string) => {
    // Mock login validation
    if (email && password) {
      setUser({ email, isLoggedIn: true });
      setCurrentScreen('dashboard');
      // Show helper bar after login for demo
      setTimeout(() => setShowHelperBar(true), 3000);
    }
  };

  const handleLogout = () => {
    setUser({ email: '', isLoggedIn: false });
    setCurrentScreen('login');
    setShowHelperBar(false);
  };

  const handleNavigate = (screen: string) => {
    setCurrentScreen(screen as Screen);
  };

  const handleShowModal = (modalType: string, data?: any) => {
    if (modalType === 'showIdentity' && data) {
      setSelectedIdentity(data);
    }
    setCurrentModal(modalType as Modal);
  };

  const handleCloseModal = () => {
    setCurrentModal('none');
    setSelectedIdentity(null);
  };

  const handleFillForm = () => {
    setShowHelperBar(false);
    // Mock form filling
    alert('Form filled with active identity data!');
  };

  const renderScreen = () => {
    switch (currentScreen) {
      case 'login':
        return <LoginScreen onLogin={handleLogin} />;
      case 'dashboard':
        return (
          <Dashboard 
            userEmail={user.email} 
            onLogout={handleLogout}
            onNavigate={handleNavigate}
          />
        );
      case 'options':
        return <OptionsPage onBack={() => setCurrentScreen('dashboard')} />;
      case 'identities':
        return (
          <IdentitiesDashboard 
            onBack={() => setCurrentScreen('dashboard')}
            onShowModal={handleShowModal}
          />
        );
      default:
        return <LoginScreen onLogin={handleLogin} />;
    }
  };

  const renderModal = () => {
    switch (currentModal) {
      case 'showIdentity':
        return selectedIdentity ? (
          <ShowIdentityModal 
            identity={selectedIdentity}
            onClose={handleCloseModal}
          />
        ) : null;
      case 'ipQualification':
        return (
          <IPQualificationModal
            isQualified={true}
            score={25}
            ipAddress="192.168.1.1"
            isp="Comcast Cable"
            onClose={handleCloseModal}
          />
        );
      case 'createWithAI':
        return (
          <CreateWithAIModal
            onClose={handleCloseModal}
            onIdentityCreated={(identity) => {
              console.log('New identity created:', identity);
              handleCloseModal();
            }}
          />
        );
      case 'fakeUser':
        return (
          <GeneratorModal
            type="fake-user"
            onClose={handleCloseModal}
          />
        );
      case 'realAddress':
        return (
          <GeneratorModal
            type="real-address"
            onClose={handleCloseModal}
          />
        );
      case 'companyInfo':
        return (
          <GeneratorModal
            type="company-info"
            onClose={handleCloseModal}
          />
        );
      case 'zepraAnswer':
        return (
          <ZepraAnswerModal
            answers={mockAnswers}
            question="What is the best architecture pattern for a scalable web application?"
            onClose={handleCloseModal}
            showReasoning={true}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Smart Helper Bar */}
      <SmartHelperBar
        isVisible={showHelperBar}
        onClose={() => setShowHelperBar(false)}
        onFillForm={handleFillForm}
        detectedFields={['Name', 'Email', 'Phone', 'Address', 'Company']}
      />

      {renderScreen()}
      {renderModal()}
      
      {user.isLoggedIn && <FloatingBubble />}
      
      {/* Enhanced Demo Navigation */}
      {user.isLoggedIn && (
        <div className="fixed top-4 left-4 z-40 flex flex-wrap gap-2">
          <button
            onClick={() => handleShowModal('ipQualification')}
            className="px-3 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700 neon-glow cyber-button"
          >
            IP Check
          </button>
          <button
            onClick={() => handleShowModal('zepraAnswer')}
            className="px-3 py-1 bg-green-600 text-white rounded text-xs hover:bg-green-700 neon-glow cyber-button"
          >
            Answer Modal
          </button>
          <button
            onClick={() => setShowHelperBar(!showHelperBar)}
            className="px-3 py-1 bg-yellow-600 text-white rounded text-xs hover:bg-yellow-700 neon-glow-yellow cyber-button"
          >
            Helper Bar
          </button>
          <button
            onClick={() => handleShowModal('fakeUser')}
            className="px-3 py-1 bg-purple-600 text-white rounded text-xs hover:bg-purple-700 neon-glow cyber-button"
          >
            User Gen
          </button>
        </div>
      )}
    </div>
  );
}