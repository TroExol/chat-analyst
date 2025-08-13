import { config } from 'dotenv';
import { VKApi } from './services/VKApi/index.js';

config();

class ChatAnalyzer {
  private isRunning: boolean = false;

  constructor() {
    console.log('🚀 Chat Analyzer инициализирован');
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('⚠️  Сервер уже запущен');
      return;
    }

    this.isRunning = true;
    console.log('✅ Сервер для парсинга запущен');

    await this.processData();
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      console.log('⚠️  Сервер не запущен');
      return;
    }

    this.isRunning = false;
    console.log('🛑 Сервер остановлен');
  }

  private async processData(): Promise<void> {
    console.log('📊 Начинаем обработку данных...');

    const vkApi = new VKApi();
    const data = await vkApi.getLongPollServerForChat();
    console.log(data);
    console.log(await vkApi.getLongPollHistory(data.ts || 0, data.pts || 0));
  }
}

const analyzer = new ChatAnalyzer();

// Обработка сигналов для корректного завершения
process.on('SIGINT', async () => {
  console.log('\n🔄 Получен сигнал завершения...');
  await analyzer.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🔄 Получен сигнал остановки...');
  await analyzer.stop();
  process.exit(0);
});

// Запуск сервера
analyzer.start().catch((error) => {
  console.error('❌ Ошибка запуска:', error);
  process.exit(1);
});
