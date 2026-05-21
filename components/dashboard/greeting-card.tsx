interface GreetingCardProps {
  greeting: string;
  userName: string;
  tip: string;
}

export function GreetingCard({ greeting, userName, tip }: GreetingCardProps) {
  return (
    <div 
      className="rounded-lg p-6 text-white"
      style={{ background: 'linear-gradient(135deg, #1e3a8a, #2563eb)' }}
    >
      <h1 className="text-[22px] font-bold mb-2">
        {greeting}, {userName}!
      </h1>
      <p className="text-[13px] opacity-90 max-w-2xl">
        {tip}
      </p>
    </div>
  );
}
