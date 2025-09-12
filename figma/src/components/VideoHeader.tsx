interface VideoHeaderProps {
  videoType: 'key' | 'zepra' | 'carry';
  className?: string;
}

export function VideoHeader({ videoType, className = "" }: VideoHeaderProps) {
  const getVideoLabel = () => {
    switch (videoType) {
      case 'key': return 'key.webm';
      case 'zepra': return 'zepra.webm';
      case 'carry': return 'carry.webm';
      default: return 'video.webm';
    }
  };

  return (
    <div className={`video-placeholder rounded-lg h-32 w-full neon-glow ${className}`}>
      <div className="text-center">
        <div className="text-sm opacity-75 mb-1">VIDEO</div>
        <div className="text-xs">{getVideoLabel()}</div>
      </div>
    </div>
  );
}