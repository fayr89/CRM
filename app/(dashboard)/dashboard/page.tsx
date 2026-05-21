import { 
  mockCurrentUser, 
  mockCompanies, 
  mockContacts, 
  mockLeads, 
  mockDeals, 
  mockActivities,
  getGreeting,
  formatCurrency,
  stageLabels,
  leadStatusLabels,
  roleLabels
} from "@/lib/mock-data";
import { GreetingCard } from "@/components/dashboard/greeting-card";
import { TodayCard } from "@/components/dashboard/today-card";
import { StatCard } from "@/components/dashboard/stat-card";
import { StatusBars } from "@/components/dashboard/status-bars";

export default function DashboardPage() {
  const user = mockCurrentUser;
  
  // Calculate stats
  const pipelineDeals = mockDeals.filter(d => !['won', 'lost'].includes(d.stage));
  const pipelineTotal = pipelineDeals.reduce((sum, d) => sum + d.amount, 0);
  const weightedPipeline = pipelineDeals.reduce((sum, d) => sum + (d.amount * d.probability / 100), 0);
  
  const wonDeals = mockDeals.filter(d => d.stage === 'won').length;
  const closedDeals = mockDeals.filter(d => ['won', 'lost'].includes(d.stage)).length;
  const conversion = closedDeals > 0 ? Math.round((wonDeals / closedDeals) * 100) : 0;
  
  const today = new Date();
  const overdueActivities = mockActivities.filter(a => {
    if (a.completedAt) return false;
    if (!a.dueDate) return false;
    return new Date(a.dueDate) < today;
  });
  const pendingActivities = mockActivities.filter(a => !a.completedAt);

  // Get role-specific tip
  const getRoleTip = () => {
    switch (user.role) {
      case 'admin':
        return 'Вы видите все данные. Раздел «Интеграции» позволяет подключить внешние сайты и Telegram-боты.';
      case 'manager':
        return 'Вы видите данные своих подчинённых. Создавайте сделки и распределяйте задачи.';
      case 'sales':
        return 'Перетащите сделку на воронке — стадия поменяется.';
      case 'warehouse':
        return 'Откройте «Прямые продажи», переключитесь на канбан и тащите заказы между стадиями.';
      default:
        return '';
    }
  };

  // Calculate leads by status
  const leadsByStatus = Object.entries(leadStatusLabels).map(([status, label]) => ({
    name: label,
    count: mockLeads.filter(l => l.status === status).length,
  })).filter(item => item.count > 0);

  // Calculate deals by stage
  const dealsByStage = Object.entries(stageLabels).map(([stage, label]) => ({
    name: label,
    count: mockDeals.filter(d => d.stage === stage).length,
  })).filter(item => item.count > 0);

  const maxLeadCount = Math.max(...leadsByStatus.map(l => l.count), 1);
  const maxDealCount = Math.max(...dealsByStage.map(d => d.count), 1);

  return (
    <div className="space-y-6">
      {/* Greeting Card */}
      <GreetingCard 
        greeting={getGreeting()}
        userName={user.name.split(' ')[0]}
        tip={getRoleTip()}
      />

      {/* Today Card */}
      <TodayCard 
        overdueCount={overdueActivities.length}
        pendingCount={pendingActivities.length}
        expectedRevenue={weightedPipeline}
      />

      {/* First Row Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Компании" value={mockCompanies.length} />
        <StatCard label="Контакты" value={mockContacts.length} />
        <StatCard label="Лиды" value={mockLeads.length} />
        <StatCard label="Сделки" value={mockDeals.length} />
      </div>

      {/* Second Row Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Сумма воронки" value={formatCurrency(pipelineTotal)} />
        <StatCard label="Взвешенная воронка" value={formatCurrency(weightedPipeline)} />
        <StatCard 
          label="Конверсия" 
          value={`${conversion}%`} 
          sub={`${wonDeals}/${closedDeals} сделок`}
        />
        <StatCard 
          label="Задачи" 
          value={pendingActivities.length}
          sub={overdueActivities.length > 0 ? `${overdueActivities.length} просрочено` : undefined}
          subDanger={overdueActivities.length > 0}
        />
      </div>

      {/* Horizontal Bars */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <StatusBars title="Лиды по статусу" items={leadsByStatus} maxCount={maxLeadCount} />
        <StatusBars title="Сделки по стадии" items={dealsByStage} maxCount={maxDealCount} />
      </div>
    </div>
  );
}
