import { useState, useEffect, useRef } from 'react';

function App() {
  const [clubs, setClubs] = useState<any[]>([]);
  const [selectedClub, setSelectedClub] = useState<string>('');
  const [pcs, setPcs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [adminVersion, setAdminVersion] = useState<string>('...');

  const [allGames, setAllGames] = useState<any[]>([]);
  const [selectedGames, setSelectedGames] = useState<string[]>([]);
  const [showGameMenu, setShowGameMenu] = useState(false);

  const [authMode, setAuthMode] = useState<'default' | 'custom'>('default');
  const [steamUser, setSteamUser] = useState('');
  const [steamPass, setSteamPass] = useState('');
  const [steamPin, setSteamPin] = useState('');
  const [showSteamPass, setShowSteamPass] = useState(false);

  const [activePc, setActivePc] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'games' | 'logs'>('games');
  const logsEndRef = useRef<HTMLDivElement>(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState('default');
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<any[]>([]);

  const [pendingActions, setPendingActions] = useState<{ [key: string]: boolean }>({});

  // 👇 НОВОЕ: Changelog
  const [showChangelog, setShowChangelog] = useState(false);
  const [changelog, setChangelog] = useState<any>(null);
  const [isFirstLoad, setIsFirstLoad] = useState(true); // 👈 НОВОЕ: Флаг первой загрузки

  // 👇 НОВОЕ: Первичная настройка
  const [showSetup, setShowSetup] = useState(false);
  const [setupData, setSetupData] = useState({
    clubName: '',
    phone: '',
    password: '',
    companyId: ''
  });
  const [setupError, setSetupError] = useState('');
  const [setupLoading, setSetupLoading] = useState(false);

  // 👇 НОВОЕ: Рефы для input'ов
  const clubNameRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const companyIdRef = useRef<HTMLInputElement>(null);

  const handleSetup = async () => {
    setSetupError('');
    setSetupLoading(true);

    try {
      const response = await fetch('/api/config/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(setupData)
      });

      const data = await response.json();

      if (!response.ok) {
        setSetupError(data.error || 'Ошибка настройки');
        setSetupLoading(false);
        return;
      }

      // Успех! Закрываем окно настройки и показываем changelog
      setShowSetup(false);
      setSetupLoading(false);

      // Загружаем данные клуба и показываем changelog
      setTimeout(() => {
        fetch('/api/config')
          .then(res => res.json())
          .then(configData => {
            setSelectedClub(configData.club);

            fetch('/api/games')
              .then(res => res.json())
              .then(gamesData => {
                setAllGames(gamesData);
                setSelectedGames(gamesData.map((g: any) => g.appId));
              });

            fetch('/api/version')
              .then(res => res.json())
              .then(versionData => {
                setAdminVersion(versionData.version);

                // Показываем changelog после успешного логина
                fetch('/CHANGELOG.json')
                  .then(res => res.json())
                  .then(changelogData => {
                    console.log('Changelog загружен:', changelogData);
                    console.log('Версия:', versionData.version);
                    console.log('Данные для версии:', changelogData[versionData.version]);
                    if (changelogData[versionData.version]) {
                      setChangelog(changelogData[versionData.version]);
                      console.log('Устанавливаем showChangelog = true');
                      setShowChangelog(true);
                    } else {
                      console.warn('Нет данных для версии:', versionData.version);
                    }
                  })
                  .catch((err) => {
                    console.error('Ошибка загрузки changelog:', err);
                  });
              });
          });
      }, 300);

    } catch (e) {
      setSetupError('Ошибка подключения к серверу');
      setSetupLoading(false);
    }
  };

  // 👇 НОВОЕ: Отправка формы по Enter
  const handleSetupKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !setupLoading && setupData.clubName && setupData.phone && setupData.password && setupData.companyId) {
      handleSetup();
    }
  };

  // 👇 НОВОЕ: Выход из клуба
  const handleLogout = async () => {
    if (!confirm('Вы уверены, что хотите выйти из клуба? Потребуется повторная настройка.')) return;

    try {
      await fetch('/api/config/logout', { method: 'POST' });

      // Сбрасываем состояние
      setShowSetup(true);
      setSelectedClub('');
      setPcs([]);
      setActivePc(null);
      setShowChangelog(false);

      // Фокусируем окно после небольшой задержки
      setTimeout(() => {
        if ((window as any).electronAPI?.focusWindow) {
          (window as any).electronAPI.focusWindow();
        }
      }, 100);
    } catch (e) {
      alert('Ошибка выхода');
    }
  };

  const closeWindow = () => { (window as any).electronAPI?.closeWindow(); };
  const minimizeWindow = () => { (window as any).electronAPI?.minimizeWindow(); };
  const maximizeWindow = () => { (window as any).electronAPI?.maximizeWindow(); };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showChangelog) return; // 👈 НЕ ЗАКРЫВАЕМ CHANGELOG ПО ESC
        if (activePc) setActivePc(null);
        if (showHistory) setShowHistory(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activePc, showHistory, showChangelog]);

  useEffect(() => {
    if (activeTab === 'logs') logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activePc?.logs, activeTab]);

  const fetchPcs = (clubId: string) => {
    fetch(`/api/pcs`)
      .then(res => res.json())
      .then(data => {
          if (Array.isArray(data)) {
              setPcs(data);
              if (activePc) {
                  const updated = data.find(p => p.id === activePc.id);
                  if (updated) setActivePc(updated);
              }
          }
      })
      .catch(() => {});
  };

  const fetchHistory = () => {
      fetch('/api/history').then(res => res.json()).then(data => setHistory(data)).catch(() => {});
  };

  useEffect(() => {
    // 👇 ПРОВЕРЯЕМ НАСТРОЙКУ ПРИ ЗАПУСКЕ
    fetch('/api/config')
      .then(res => res.json())
      .then(data => {
        if (!data.setupCompleted) {
          setShowSetup(true);
          return;
        }

        // 👇 Если настройка завершена, используем настроенный клуб
        setSelectedClub(data.club);

        fetch('/api/games')
          .then(res => res.json())
          .then(gamesData => {
            setAllGames(gamesData);
            setSelectedGames(gamesData.map((g: any) => g.appId));
          });

        fetch('/api/version')
          .then(res => res.json())
          .then(versionData => {
            setAdminVersion(versionData.version);

            // 👇 ЗАГРУЖАЕМ CHANGELOG, НО НЕ ПОКАЗЫВАЕМ АВТОМАТИЧЕСКИ
            fetch('/CHANGELOG.json')
              .then(res => res.json())
              .then(changelogData => {
                if (changelogData[versionData.version]) {
                  setChangelog(changelogData[versionData.version]);
                  // ❌ НЕ ПОКАЗЫВАЕМ АВТОМАТИЧЕСКИ: setShowChangelog(true);
                  // Changelog будет показан только:
                  // 1. После успешного логина (в handleSetup)
                  // 2. При клике на кнопку версии
                }
              })
              .catch(() => {});
          })
          .catch(() => {});
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedClub) return;
    setLoading(true);
    fetchPcs(selectedClub);
    setLoading(false);

    const interval = setInterval(() => { fetchPcs(selectedClub); }, 2000); 
    return () => clearInterval(interval);
  }, [selectedClub, activePc?.id]); 

  useEffect(() => {
      if (showHistory) {
          fetchHistory();
          const int = setInterval(fetchHistory, 5000);
          return () => clearInterval(int);
      }
  }, [showHistory]);

  const toggleGame = (appId: string) => {
    if (selectedGames.includes(appId)) setSelectedGames(selectedGames.filter(id => id !== appId));
    else setSelectedGames([...selectedGames, appId]);
  };

  const getAuthPayload = () => {
      if (authMode === 'custom' && steamUser && steamPass) return { username: steamUser, password: steamPass, pin: steamPin };
      return null;
  };

  const handleUpdateAllFree = async () => {
    if (!selectedClub || selectedGames.length === 0) return alert('Выберите игры');
    try {
      const gamesToUpdate = allGames.filter(g => selectedGames.includes(g.appId));
      const response = await fetch('/api/update_all_free', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clubId: selectedClub, games: gamesToUpdate, customAuth: null })
      });
      const data = await response.json();
      if (data.success) alert(`Команда на обновление отправлена на ${data.count} ПК!`);
    } catch (e) { alert('Ошибка'); }
  };

  const handleClearWorkshopAll = async () => {
    if (!selectedClub) return;
    if (!window.confirm("Вы уверены, что хотите ОЧИСТИТЬ МАСТЕРСКИЕ на всех свободных ПК?")) return;
    try {
      const response = await fetch('/api/clear_workshop_all_free', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clubId: selectedClub })
      });
      const data = await response.json();
      if (data.success) alert(`Команда на очистку отправлена на ${data.count} ПК!`);
    } catch (e) { alert('Ошибка'); }
  };

  const handleUpdateAgentsAll = async () => {
    if (!selectedClub) return;
    if (!window.confirm("Отправить команду на обновление агента всем ПК в сети?")) return;
    try {
      const response = await fetch('/api/update_agents_all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clubId: selectedClub })
      });
      const data = await response.json();
      if (data.success) alert(`Команда на обновление агентов отправлена на ${data.count} ПК!`);
    } catch (e) { alert('Ошибка'); }
  };

  const handleGameAction = async (ip: string, appId: string | null, action: 'install_or_update' | 'uninstall' | 'clear_workshop' | 'cancel_all' | 'update_agent' | 'check_game') => {
    if (!ip) return alert('У этого ПК нет IP');

    if (action === 'uninstall') {
      const gameName = allGames.find(g => g.appId === appId)?.name || 'эту игру';
      if (!window.confirm(`Вы уверены, что хотите УДАЛИТЬ ${gameName}?\n\nИгра будет полностью удалена с компьютера.`)) return;
    }
    if (action === 'clear_workshop' && !window.confirm("Вы уверены, что хотите ОЧИСТИТЬ МАСТЕРСКУЮ на этом ПК?")) return;
    if (action === 'cancel_all' && !window.confirm("Вы уверены, что хотите ОТМЕНИТЬ ВСЕ ТЕКУЩИЕ ЗАДАЧИ на этом ПК?")) return;
    if (action === 'update_agent' && !window.confirm("Обновить агента на этом ПК? (ПК перезагружать не нужно)")) return;
    // Подтверждение для проверки не нужно, это легкая операция

    const key = `${ip}_${appId || 'null'}_${action}`;
    setPendingActions(prev => ({ ...prev, [key]: true }));
    setTimeout(() => {
        setPendingActions(prev => {
            const next = { ...prev };
            delete next[key];
            return next;
        });
    }, 8000);

    try {
      const response = await fetch('/api/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip: ip, action: action, appId: appId, customAuth: getAuthPayload() })
      });

      if (!response.ok) {
        throw new Error('Ошибка сервера');
      }

      console.log(`✅ Команда ${action} отправлена на ${ip}`);
    } catch (e) {
      console.error('Ошибка при отправке команды:', e);
      alert('Ошибка при отправке команды');
    }
  };

  const getModalGamesList = () => {
      if (!activePc) return allGames;
      const installedNotInList = (activePc.installedGamesData || []).filter(
          (instGame: any) => !allGames.some(g => g.appId === instGame.appId)
      );
      return [...allGames, ...installedNotInList];
  };

  const renderStatus = (status: string) => {
    if (status === 'Свободен') return <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-green-500/10 text-green-400 border border-green-500/20"><span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>Свободен</span>;
    if (status === 'Обслуживание') return <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-yellow-500/10 text-yellow-500 border border-yellow-500/20"><span className="w-2 h-2 rounded-full bg-yellow-500"></span>Обслуживание</span>;
    if (status === 'В игре') return <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-blue-500/10 text-blue-400 border border-blue-500/20"><span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></span>В игре</span>;
    return <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-gray-500/10 text-gray-400 border border-gray-500/20"><span className="w-2 h-2 rounded-full bg-gray-500"></span>Оффлайн</span>;
  };

  const renderGameProgress = (gameName: string) => {
      if (!activePc || !activePc.update) return null;
      const statusStr = activePc.update;

      // Проверяем, идёт ли процесс с этой игрой
      if (statusStr.includes(gameName) && (statusStr.includes('⏳') || statusStr.includes('🗑️') || statusStr.includes('🔄'))) {
          const percentMatch = statusStr.match(/(\d+)%/);
          let displayStr = statusStr.replace('⏳ ', '').replace('🗑️ ', '').replace('🔄 ', '');
          let percent = percentMatch ? parseInt(percentMatch[1]) : 0;

          // Определяем тип процесса для правильного цвета
          const isDeleting = statusStr.includes('🗑️') || statusStr.toLowerCase().includes('удален');
          const barColor = isDeleting ? 'bg-red-500' : 'bg-club-accent';

          return (
              <div className="flex flex-col w-48 items-end justify-center">
                  <div className={`text-xs ${isDeleting ? 'text-red-400' : 'text-club-accent'} mb-1 font-bold animate-pulse`}>{displayStr}</div>
                  <div className="w-full bg-gray-800 rounded-full h-1.5 overflow-hidden">
                      <div className={`${barColor} h-1.5 rounded-full transition-all duration-500 ${percent === 0 ? 'animate-pulse w-full opacity-50' : ''}`} style={{ width: percent > 0 ? `${percent}%` : '100%' }}></div>
                  </div>
              </div>
          );
      }
      return null;
  };

  const processedPcs = pcs
    .filter(pc => pc.id.toLowerCase().includes(searchTerm.toLowerCase()))
    .sort((a, b) => {
        if (sortBy === 'status') {
            const order: any = { 'В игре': 1, 'Свободен': 2, 'Обслуживание': 3, 'Оффлайн': 4 };
            return (order[a.status] || 99) - (order[b.status] || 99);
        }
        if (sortBy === 'needs_update') {
            const aHas = (a.queue?.length > 0 || a.update?.includes('⏳') || a.update?.includes('❌') || a.update?.includes('🔄')) ? 1 : 0;
            const bHas = (b.queue?.length > 0 || b.update?.includes('⏳') || b.update?.includes('❌') || b.update?.includes('🔄')) ? 1 : 0;
            return bHas - aHas;
        }
        return 0;
    });

  return (
    <div className="min-h-screen bg-club-bg text-white font-sans relative flex flex-col">

      {/* HEADER С КНОПКАМИ УПРАВЛЕНИЯ ОКНОМ */}
      <div
        className="flex items-center justify-between px-6 py-2 bg-black border-b border-club-panel select-none sticky top-0 z-50"
        style={{
          WebkitAppRegion: (showSetup || showChangelog) ? 'no-drag' : 'drag'
        } as React.CSSProperties}
      >
        {!showSetup ? (
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="Logo" className="h-7 w-auto" />
            <h1 className="text-club-accent text-lg font-bold tracking-wider">CLUB UPDATE</h1>
            <button
              onClick={() => {
                console.log('Кнопка версии нажата, showChangelog:', showChangelog, 'changelog:', changelog);
                if (changelog) {
                  setShowChangelog(true);
                } else {
                  console.warn('Changelog не загружен!');
                }
              }}
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              className="text-[10px] text-gray-500 font-mono bg-gray-800 px-2 py-1 rounded border border-gray-700 hover:border-club-accent hover:text-club-accent transition-all cursor-pointer flex items-center gap-1.5"
              title="Что нового в версии"
            >
              <span>v{adminVersion}</span>
              <span className="text-xs">✨</span>
            </button>
            <button
              onClick={handleLogout}
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              className="text-[10px] text-gray-400 font-mono bg-gray-800 px-2 py-1 rounded border border-gray-700 hover:border-red-500 hover:text-red-400 transition-all cursor-pointer flex items-center gap-1.5"
              title="Выйти из клуба"
            >
              <span>🚪</span>
              <span>Выйти</span>
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="Logo" className="h-7 w-auto" />
            <h1 className="text-club-accent text-lg font-bold tracking-wider">CLUB UPDATE</h1>
          </div>
        )}

        <div className="flex items-center gap-1">
          <button onClick={minimizeWindow} style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties} className="w-10 h-7 flex items-center justify-center text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors" title="Свернуть">─</button>
          <button onClick={maximizeWindow} style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties} className="w-10 h-7 flex items-center justify-center text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors" title="Развернуть">□</button>
          <button onClick={closeWindow} style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties} className="w-10 h-7 flex items-center justify-center text-gray-400 hover:text-white hover:bg-red-600 rounded transition-colors" title="Закрыть">✕</button>
        </div>
      </div>

      {/* ОСНОВНОЙ КОНТЕНТ — ПОКАЗЫВАЕМ ТОЛЬКО ЕСЛИ НЕ В РЕЖИМЕ НАСТРОЙКИ */}
      {!showSetup && (
      <div className="p-8 flex-1 overflow-auto">
        <header className="flex flex-wrap justify-between items-center gap-4 mb-8 border-b border-club-panel pb-4 bg-club-bg sticky top-0 z-40 -mx-8 px-8">
          <div className="flex items-center gap-4">
            {/* 👇 УБРАЛИ ВЫБОР КЛУБА */}

            <input type="text" placeholder="Поиск по ПК..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="bg-club-panel text-white border border-gray-700 rounded px-3 py-1.5 text-sm outline-none focus:border-club-accent w-40" />
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="bg-club-panel text-white border border-gray-700 rounded px-2 py-1.5 text-sm outline-none focus:border-club-accent cursor-pointer">
                <option value="default">По умолчанию</option>
                <option value="status">По статусу</option>
                <option value="needs_update">Требуют внимания</option>
            </select>
          </div>
          
          <div className="flex gap-3 relative">
            <div className="bg-club-panel border border-gray-700 rounded px-3 py-2 flex flex-col gap-1 text-sm">
              <div className="flex items-center gap-2">
                  <input type="checkbox" id="customAuth" checked={authMode === 'custom'} onChange={(e) => setAuthMode(e.target.checked ? 'custom' : 'default')} className="accent-club-accent cursor-pointer" />
                  <label htmlFor="customAuth" className="text-gray-300 cursor-pointer select-none hover:text-white transition-colors" title="Использовать другой аккаунт для установки игр в модальном окне">Свой Steam</label>
              </div>
              {authMode === 'custom' && (
                  <div className="flex gap-2 mt-1">
                      <input type="text" placeholder="Логин" value={steamUser} onChange={e => setSteamUser(e.target.value)} className="w-20 bg-[#1a1a1a] border border-gray-600 rounded px-2 py-1 text-xs outline-none focus:border-club-accent" />
                      <div className="relative flex items-center">
                          <input type={showSteamPass ? "text" : "password"} placeholder="Пароль" value={steamPass} onChange={e => setSteamPass(e.target.value)} className="w-24 bg-[#1a1a1a] border border-gray-600 rounded px-2 py-1 text-xs outline-none focus:border-club-accent pr-6" />
                          <button type="button" onClick={() => setShowSteamPass(!showSteamPass)} className="absolute right-1 text-gray-500 hover:text-white transition-colors cursor-pointer text-xs" title={showSteamPass ? "Скрыть пароль" : "Показать пароль"}>{showSteamPass ? '🙈' : '👁️'}</button>
                      </div>
                      <input type="text" placeholder="PIN" value={steamPin} onChange={e => setSteamPin(e.target.value)} className="w-16 bg-[#1a1a1a] border border-gray-600 rounded px-2 py-1 text-xs outline-none focus:border-club-accent" title="Family View PIN" />
                  </div>
              )}
              <div className="text-[10px] text-gray-500 max-w-[200px] leading-tight mt-1">* Кнопка «Обновить» всегда использует клубный аккаунт.</div>
            </div>

            <div className="relative">
              <button onClick={() => setShowGameMenu(!showGameMenu)} className="bg-club-panel hover:bg-gray-800 border border-gray-700 hover:border-gray-500 text-white py-2 px-4 rounded transition-all duration-200 active:scale-95 h-full cursor-pointer">🎮 Игры ({selectedGames.length})</button>
              {showGameMenu && (
                <div className="absolute top-full right-0 mt-2 w-64 bg-club-panel border border-gray-700 rounded shadow-xl z-50 p-2">
                  <div className="flex justify-between items-center mb-2 px-2 border-b border-gray-700 pb-2">
                    <button onClick={() => setSelectedGames(allGames.map(g => g.appId))} className="text-xs text-club-accent hover:text-white transition-colors">Выбрать все</button>
                  </div>
                  {allGames.map(game => (
                    <label key={game.appId} className="flex items-center gap-2 p-2 hover:bg-[#2a2a2a] cursor-pointer rounded transition-colors">
                      <input type="checkbox" checked={selectedGames.includes(game.appId)} onChange={() => toggleGame(game.appId)} className="accent-club-accent w-4 h-4 cursor-pointer" />
                      <span className="text-sm">{game.name}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <button onClick={() => setShowHistory(true)} className="bg-club-panel hover:bg-gray-800 border border-gray-700 text-white py-2 px-4 rounded transition-all duration-200 active:scale-95 h-full cursor-pointer">📜 История</button>
            <button onClick={handleUpdateAgentsAll} className="bg-club-panel hover:bg-gray-800 border border-yellow-500/50 text-yellow-400 hover:text-yellow-300 py-2 px-4 rounded transition-all duration-200 active:scale-95 h-full cursor-pointer" title="Обновить агента на всех онлайн ПК">🔄 Обновить агентов</button>
            <button onClick={handleClearWorkshopAll} className="bg-club-panel hover:bg-red-900/40 border border-red-500/30 text-red-400 hover:text-red-300 py-2 px-4 rounded transition-all duration-200 active:scale-95 h-full cursor-pointer" title="Очистить папку workshop на всех свободных ПК">🗑️ Очистить Мастерские</button>
            <button onClick={handleUpdateAllFree} className="bg-club-accent hover:brightness-110 text-black font-bold py-2 px-4 rounded transition-all duration-200 active:scale-95 shadow-[0_0_15px_rgba(255,212,0,0.3)] hover:shadow-[0_0_20px_rgba(255,212,0,0.5)] h-full cursor-pointer">Обновить свободные</button>
          </div>
        </header>

        {loading ? (
          <div className="text-club-accent text-center mt-10 font-bold text-xl">Загрузка ПК...</div>
        ) : (
          <div className="bg-club-panel rounded-xl border border-gray-800 overflow-hidden">
            <div className="grid grid-cols-7 bg-[#222] p-4 text-gray-400 text-sm font-semibold uppercase tracking-wider border-b border-gray-800">
              <div>Компьютер</div>
              <div>Статус</div>
              <div>Свободно на диске</div>
              <div>Мастерская</div>
              <div className="col-span-2">Установлено игр</div>
              <div>Обновления / Очередь</div>
            </div>
            <div className="divide-y divide-gray-800">
              {processedPcs.map((pc) => (
                <div key={pc.id} onClick={() => setActivePc(pc)} className="grid grid-cols-7 p-4 items-center hover:bg-[#222] cursor-pointer transition-colors group">
                  <div><span className="inline-flex items-center justify-center font-bold text-sm bg-[#222] border border-gray-700 text-club-accent px-4 py-1.5 rounded-full shadow-sm group-hover:border-club-accent group-hover:text-white transition-all">{pc.id}</span></div>
                  <div>{renderStatus(pc.status)}</div>
                  <div className="text-gray-300 text-sm">{pc.disk}</div>
                  <div className="text-orange-400 text-sm font-bold">{pc.workshopSize}</div>
                  <div className="col-span-2 flex flex-wrap gap-1 text-xs max-h-[60px] overflow-hidden hover:overflow-y-auto pr-2">
                    {pc.installedGamesData && pc.installedGamesData.length > 0 ? (
                      pc.installedGamesData.map((g: any) => (
                        <span key={g.appId} className="bg-gray-800 border border-gray-700 px-2 py-1 rounded text-gray-300 whitespace-nowrap">{g.name}</span>
                      ))
                    ) : (
                      <span className="text-gray-500 italic">Не найдены</span>
                    )}
                  </div>
                  <div className="flex flex-col gap-1">
                      <div className={`font-medium text-sm ${pc.updateColor}`}>{pc.update}</div>
                      {pc.queue && pc.queue.length > 0 && <div className="text-[10px] text-gray-400">В очереди: {pc.queue.length} задач</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {showHistory && (
          <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50" onClick={() => setShowHistory(false)}>
            <div className="bg-club-panel w-[800px] rounded-xl border border-gray-700 shadow-2xl overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
              <div className="flex justify-between items-center p-4 border-b border-gray-700 bg-[#222]">
                <h2 className="text-xl font-bold text-club-accent">История последних задач</h2>
                <button onClick={() => setShowHistory(false)} className="text-gray-400 hover:text-red-500 text-3xl leading-none transition-colors cursor-pointer" title="Закрыть (Esc)">&times;</button>
              </div>
              <div className="p-4 overflow-y-auto max-h-[70vh]">
                  {history.length === 0 ? (
                      <div className="text-gray-500 italic text-center py-10">Пока нет завершенных задач.</div>
                  ) : (
                      <table className="w-full text-left text-sm text-gray-300">
                          <thead className="text-xs uppercase bg-gray-800 text-gray-400">
                              <tr><th className="px-4 py-2 rounded-tl-lg">Время</th><th className="px-4 py-2">ПК</th><th className="px-4 py-2">Действие</th><th className="px-4 py-2 rounded-tr-lg">Статус</th></tr>
                          </thead>
                          <tbody className="divide-y divide-gray-800">
                              {history.map((item) => (
                                  <tr key={item.id} className="hover:bg-[#2a2a2a] transition-colors">
                                      <td className="px-4 py-2 whitespace-nowrap">{item.time}</td>
                                      <td className="px-4 py-2 font-bold text-club-accent">{item.pc}</td>
                                      <td className="px-4 py-2">{item.action}</td>
                                      <td className="px-4 py-2">{item.status === 'success' ? <span className="text-green-500 font-bold">Успешно</span> : <span className="text-red-500 font-bold">Ошибка</span>}</td>
                                  </tr>
                              ))}
                          </tbody>
                      </table>
                  )}
              </div>
              <div className="p-4 border-t border-gray-700 bg-[#222] flex justify-end">
                <button onClick={() => setShowHistory(false)} className="bg-gray-700 hover:bg-gray-600 text-white py-2 px-6 rounded transition-all duration-200 active:scale-95 cursor-pointer">Закрыть</button>
              </div>
            </div>
          </div>
        )}

        {activePc && (
          <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50" onClick={() => setActivePc(null)}>
            <div className="bg-club-panel w-[750px] rounded-xl border border-gray-700 shadow-2xl overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
              
              <div className="flex justify-between items-center p-4 border-b border-gray-700 bg-[#222]">
                <h2 className="text-xl font-bold flex items-center gap-3 text-white">Управление: <span className="bg-black/50 border border-gray-600 text-club-accent px-4 py-1 rounded-full text-lg shadow-inner">{activePc.id}</span></h2>
                <button onClick={() => setActivePc(null)} className="text-gray-400 hover:text-red-500 text-3xl leading-none transition-colors cursor-pointer" title="Закрыть (Esc)">&times;</button>
              </div>

              <div className="flex border-b border-gray-700 bg-[#1a1a1a]">
                  <button onClick={() => setActiveTab('games')} className={`flex-1 py-3 font-bold text-sm transition-colors ${activeTab === 'games' ? 'text-club-accent border-b-2 border-club-accent bg-[#222]' : 'text-gray-400 hover:text-white'}`}>🎮 Игры и Очередь</button>
                  <button onClick={() => setActiveTab('logs')} className={`flex-1 py-3 font-bold text-sm transition-colors ${activeTab === 'logs' ? 'text-club-accent border-b-2 border-club-accent bg-[#222]' : 'text-gray-400 hover:text-white'}`}>🖥️ Консоль (Логи)</button>
              </div>
              
              <div className="p-4 overflow-y-auto max-h-[65vh] bg-club-panel">
                
                {activeTab === 'games' && (
                  <>
                    <div className="mb-4 text-sm text-gray-400 flex items-center justify-between bg-[#1a1a1a] p-3 rounded-lg border border-gray-800">
                      <div className="flex items-center gap-2">
                          <span>Статус ПК:</span>
                          <span className="font-bold text-white bg-gray-800 px-3 py-1 rounded-full border border-gray-600 text-xs">{activePc.id}</span>
                          <span className="ml-2">{renderStatus(activePc.status)}</span>
                          <span className="ml-4">Задача: <span className={`font-bold ${activePc.updateColor}`}>{activePc.update}</span></span>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                          <div className="text-xs text-gray-500">Мастерская: <span className="text-orange-400 font-bold">{activePc.workshopSize}</span></div>
                          <div className="text-[10px] text-gray-500">Версия агента: <span className="text-green-400 font-mono">{activePc.agentVersion}</span></div>
                      </div>
                    </div>

                    {activePc.queue && activePc.queue.length > 0 && (
                        <div className="mb-4 bg-club-panel border border-club-accent/30 rounded-lg p-3">
                            <h4 className="text-sm font-bold text-club-accent mb-2">⏳ В очереди на выполнение:</h4>
                            <ul className="text-xs text-gray-300 space-y-1">
                                {activePc.queue.map((taskName: string, i: number) => (
                                    <li key={i} className="flex items-center gap-2"><span className="text-gray-500">{i + 1}.</span>{taskName}</li>
                                ))}
                            </ul>
                        </div>
                    )}
                    
                    <div className="space-y-2">
                      {getModalGamesList().map((game: any) => {
                        const isInstalled = activePc.installedGamesData?.some((g: any) => g.appId === game.appId);
                        const isCurrentTask = activePc.update && activePc.update.includes(game.name) && (activePc.update.includes('⏳') || activePc.update.includes('🗑️') || activePc.update.includes('🔄'));
                        const isInQueue = activePc.queue && activePc.queue.includes(game.name) && !isCurrentTask;
                        
                        const isPendingUninstall = pendingActions[`${activePc.ip}_${game.appId}_uninstall`];
                        const isPendingInstall = pendingActions[`${activePc.ip}_${game.appId}_install_or_update`];
                        const isPendingCheck = pendingActions[`${activePc.ip}_${game.appId}_check_game`];
                        const isAnyPending = isPendingUninstall || isPendingInstall || isPendingCheck;

                        // 👇 ПОЛУЧАЕМ СТАТУС ИГРЫ
                        const updateStatus = activePc.gameUpdateStatus?.[game.appId];

                        return (
                          <div key={game.appId} className={`flex justify-between items-center p-3 rounded border transition-all duration-200 ${isCurrentTask ? 'bg-[#2a2a2a] border-club-accent/50' : 'bg-[#1a1a1a] border-gray-800 hover:border-gray-600'}`}>
                            <div className="flex flex-col w-1/2">
                              <span className="font-bold truncate">{game.name}</span>
                              <span className={`text-xs ${isInstalled ? 'text-green-500' : 'text-gray-500'}`}>{isInstalled ? 'Установлена' : 'Не установлена'}</span>
                            </div>
                            
                            <div className="flex justify-end w-1/2">
                              {isCurrentTask ? (
                                  renderGameProgress(game.name)
                              ) : isInQueue ? (
                                  <span className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full font-bold text-sm bg-yellow-500/10 text-yellow-500 border border-yellow-500/30 animate-pulse">⏳ В очереди</span>
                              ) : isAnyPending ? (
                                  <span className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full font-bold text-sm bg-gray-500/10 text-gray-400 border border-gray-500/30 animate-pulse">⏳ Отправка...</span>
                              ) : !isInstalled ? (
                                  // НЕ УСТАНОВЛЕНА -> УСТАНОВИТЬ
                                  <button onClick={() => handleGameAction(activePc.ip, game.appId, 'install_or_update')} className="py-1.5 px-4 rounded font-bold text-sm transition-all duration-200 cursor-pointer bg-club-accent hover:brightness-110 text-black shadow-[0_0_10px_rgba(255,212,0,0.2)] hover:shadow-[0_0_15px_rgba(255,212,0,0.5)] active:scale-95">Установить</button>
                              ) : updateStatus === '🔄 Есть обновление' ? (
                                  // ЕСТЬ ОБНОВЛЕНИЕ -> ОБНОВИТЬ + УДАЛИТЬ
                                  <div className="flex gap-2">
                                      <button onClick={(e) => { e.stopPropagation(); handleGameAction(activePc.ip, game.appId, 'uninstall'); }} className="py-1.5 px-4 rounded font-bold text-sm transition-all duration-200 cursor-pointer bg-red-500/10 text-red-500 border border-red-500/30 hover:bg-red-500 hover:text-white hover:border-red-500 active:scale-95">Удалить</button>
                                      <button onClick={(e) => { e.stopPropagation(); handleGameAction(activePc.ip, game.appId, 'install_or_update'); }} className="py-1.5 px-4 rounded font-bold text-sm transition-all duration-200 cursor-pointer bg-club-accent hover:brightness-110 text-black shadow-[0_0_10px_rgba(255,212,0,0.2)] hover:shadow-[0_0_15px_rgba(255,212,0,0.5)] active:scale-95">Обновить</button>
                                  </div>
                              ) : (
                                  // УСТАНОВЛЕНА -> ВСЕГДА ПОКАЗЫВАЕМ УДАЛИТЬ + ПРОВЕРИТЬ
                                  <div className="flex items-center gap-2">
                                      {updateStatus === '✅ Актуален' && <span className="text-xs text-green-500 font-bold">✅ Актуален</span>}
                                      {updateStatus === '❓ Ошибка' && <span className="text-xs text-red-500 font-bold">❓ Ошибка</span>}
                                      <button onClick={(e) => { e.stopPropagation(); handleGameAction(activePc.ip, game.appId, 'uninstall'); }} className="py-1.5 px-4 rounded font-bold text-sm transition-all duration-200 cursor-pointer bg-red-500/10 text-red-500 border border-red-500/30 hover:bg-red-500 hover:text-white hover:border-red-500 active:scale-95">Удалить</button>
                                      <button onClick={(e) => { e.stopPropagation(); handleGameAction(activePc.ip, game.appId, 'check_game'); }} className="py-1.5 px-4 rounded font-bold text-sm transition-all duration-200 cursor-pointer bg-gray-700 hover:bg-gray-600 text-white active:scale-95">Проверить</button>
                                  </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}

                {activeTab === 'logs' && (
                    <div className="bg-black text-green-400 font-mono text-xs p-4 rounded-lg h-[50vh] overflow-y-auto border border-gray-700 shadow-inner">
                        {activePc.logs && activePc.logs.length > 0 ? (
                            activePc.logs.map((logLine: string, i: number) => (<div key={i} className="mb-1 break-words">{logLine}</div>))
                        ) : (
                            <div className="text-gray-500 italic">Логи пусты. Агент еще не присылал данные.</div>
                        )}
                        <div ref={logsEndRef} />
                    </div>
                )}

              </div>
              
              <div className="p-4 border-t border-gray-700 bg-[#222] flex justify-between items-center">
                <div className="flex gap-2">
                  <button onClick={() => handleGameAction(activePc.ip, null, 'clear_workshop')} className="bg-red-500/10 hover:bg-red-500 text-red-500 hover:text-white border border-red-500/30 py-2 px-6 rounded transition-all duration-200 active:scale-95 cursor-pointer font-bold text-sm">🗑️ Очистить Мастерскую</button>
                  <button onClick={() => handleGameAction(activePc.ip, null, 'update_agent')} className="bg-yellow-500/10 hover:bg-yellow-500 text-yellow-500 hover:text-black border border-yellow-500/30 py-2 px-6 rounded transition-all duration-200 active:scale-95 cursor-pointer font-bold text-sm">🔄 Обновить агента</button>
                  {(activePc.queue?.length > 0 || activePc.update?.includes('⏳') || activePc.update?.includes('🔄')) && (
                    <button onClick={() => handleGameAction(activePc.ip, null, 'cancel_all')} className="bg-orange-500/10 hover:bg-orange-500 text-orange-500 hover:text-white border border-orange-500/30 py-2 px-6 rounded transition-all duration-200 active:scale-95 cursor-pointer font-bold text-sm">🛑 Отменить всё</button>
                  )}
                </div>
                <button onClick={() => setActivePc(null)} className="bg-gray-700 hover:bg-gray-600 text-white py-2 px-6 rounded transition-all duration-200 active:scale-95 cursor-pointer">Закрыть</button>
              </div>
            </div>
          </div>
        )}


          <div className="fixed bottom-4 right-6 text-gray-600 text-xs tracking-wider pointer-events-none select-none">
            powered by <span className="text-club-accent/50 font-bold hover:text-club-accent transition-colors">DeeMas1k</span>
          </div>
        </div>
      )}

      {/* МОДАЛЬНЫЕ ОКНА ВНЕ КОНТЕЙНЕРА С OVERFLOW-AUTO */}

      {/* ОКНО ПЕРВИЧНОЙ НАСТРОЙКИ */}
      {showSetup && (
        <div
          className="fixed inset-0 bg-black/95 backdrop-blur-sm flex items-center justify-center z-[99999]"
          onClick={(e) => {
            // Закрываем только если кликнули на затемнённый фон (не на модальное окно)
            if (e.target === e.currentTarget) {
              // Ничего не делаем — окно настройки нельзя закрыть кликом на фон
            }
          }}
        >
          <div
            className="bg-gradient-to-b from-club-panel to-[#1a1a1a] w-[600px] rounded-2xl border-2 border-club-accent/50 shadow-[0_0_50px_rgba(255,212,0,0.3)] overflow-hidden"
            onClick={(e) => {
              // Останавливаем всплытие, чтобы клик по модальному окну не попал на оверлей
              e.stopPropagation();
            }}
          >

            {/* HEADER */}
            <div className="relative p-8 border-b border-club-accent/30 bg-gradient-to-r from-club-accent/20 via-club-accent/10 to-transparent">
              <div className="absolute inset-0 opacity-20">
                <div className="absolute top-0 left-0 w-32 h-32 bg-club-accent rounded-full blur-3xl animate-pulse"></div>
                <div className="absolute bottom-0 right-0 w-40 h-40 bg-club-accent rounded-full blur-3xl animate-pulse delay-700"></div>
              </div>

              <div className="relative z-10 text-center">
                <div className="text-6xl mb-4 animate-bounce">👋</div>
                <h2 className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-club-accent via-yellow-300 to-club-accent animate-gradient mb-2">
                  Добро пожаловать!
                </h2>
                <p className="text-gray-300">Настроим подключение к SmartShell</p>
              </div>
            </div>

            {/* FORM */}
            <div className="p-8 space-y-4">
              <div>
                <label className="block text-sm font-bold text-gray-300 mb-2">Название вашего клуба</label>
                <input
                  ref={clubNameRef}
                  type="text"
                  placeholder="Например: Киберклуб Гейминг"
                  value={setupData.clubName}
                  onChange={(e) => setSetupData({...setupData, clubName: e.target.value})}
                  onKeyPress={handleSetupKeyPress}
                  onMouseDown={(e) => {
                    console.log('Input mousedown, попытка фокуса...');
                    // Используем нативный DOM API с задержкой
                    setTimeout(() => {
                      if (clubNameRef.current) {
                        clubNameRef.current.focus();
                        console.log('Фокус установлен на:', document.activeElement);
                      }
                    }, 0);
                  }}
                  style={{
                    WebkitAppRegion: 'no-drag',
                    pointerEvents: 'auto',
                    cursor: 'text'
                  } as React.CSSProperties}
                  className="w-full bg-[#222] border border-gray-700 rounded-lg px-4 py-3 text-white outline-none focus:border-club-accent transition-colors"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-gray-300 mb-2">Телефон (менеджера SmartShell)</label>
                <input
                  ref={phoneRef}
                  type="tel"
                  placeholder="79001234567"
                  value={setupData.phone}
                  onChange={(e) => setSetupData({...setupData, phone: e.target.value})}
                  onKeyPress={handleSetupKeyPress}
                  onMouseDown={() => {
                    setTimeout(() => {
                      if (phoneRef.current) {
                        phoneRef.current.focus();
                        console.log('Фокус на телефоне, activeElement:', document.activeElement);
                      }
                    }, 0);
                  }}
                  style={{
                    WebkitAppRegion: 'no-drag',
                    pointerEvents: 'auto',
                    cursor: 'text'
                  } as React.CSSProperties}
                  className="w-full bg-[#222] border border-gray-700 rounded-lg px-4 py-3 text-white outline-none focus:border-club-accent transition-colors"
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-gray-300 mb-2">Пароль от SmartShell</label>
                <input
                  ref={passwordRef}
                  type="password"
                  placeholder="••••••••"
                  value={setupData.password}
                  onChange={(e) => setSetupData({...setupData, password: e.target.value})}
                  onKeyPress={handleSetupKeyPress}
                  onMouseDown={() => {
                    setTimeout(() => {
                      if (passwordRef.current) {
                        passwordRef.current.focus();
                        console.log('Фокус на пароле, activeElement:', document.activeElement);
                      }
                    }, 0);
                  }}
                  style={{
                    WebkitAppRegion: 'no-drag',
                    pointerEvents: 'auto',
                    cursor: 'text'
                  } as React.CSSProperties}
                  className="w-full bg-[#222] border border-gray-700 rounded-lg px-4 py-3 text-white outline-none focus:border-club-accent transition-colors"
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-gray-300 mb-2">ID компании (Company ID)</label>
                <input
                  ref={companyIdRef}
                  type="text"
                  placeholder="2165"
                  value={setupData.companyId}
                  onChange={(e) => setSetupData({...setupData, companyId: e.target.value})}
                  onKeyPress={handleSetupKeyPress}
                  onMouseDown={() => {
                    setTimeout(() => {
                      if (companyIdRef.current) {
                        companyIdRef.current.focus();
                        console.log('Фокус на Company ID, activeElement:', document.activeElement);
                      }
                    }, 0);
                  }}
                  style={{
                    WebkitAppRegion: 'no-drag',
                    pointerEvents: 'auto',
                    cursor: 'text'
                  } as React.CSSProperties}
                  className="w-full bg-[#222] border border-gray-700 rounded-lg px-4 py-3 text-white outline-none focus:border-club-accent transition-colors"
                />
                <p className="text-xs text-gray-500 mt-1">Найдите в настройках SmartShell</p>
              </div>

              {setupError && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm">
                  ⚠️ {setupError}
                </div>
              )}
            </div>

            {/* FOOTER */}
            <div className="p-6 border-t border-club-accent/30 bg-gradient-to-r from-[#1a1a1a] to-[#222]">
              <button
                onClick={handleSetup}
                disabled={setupLoading || !setupData.clubName || !setupData.phone || !setupData.password || !setupData.companyId}
                className="w-full bg-gradient-to-r from-club-accent to-yellow-400 hover:from-yellow-400 hover:to-club-accent text-black font-bold py-4 rounded-lg transition-all duration-300 active:scale-95 cursor-pointer shadow-[0_0_20px_rgba(255,212,0,0.4)] hover:shadow-[0_0_30px_rgba(255,212,0,0.6)] disabled:opacity-50 disabled:cursor-not-allowed transform hover:scale-105 disabled:hover:scale-100"
              >
                {setupLoading ? '⏳ Проверяем данные...' : '🚀 Начать работу'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ОКНО CHANGELOG */}
      {showChangelog && changelog && (
        <div
          className="fixed inset-0 bg-black/95 backdrop-blur-sm flex items-center justify-center z-[99998] animate-[fadeIn_0.3s_ease-out]"
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="bg-gradient-to-b from-club-panel to-[#1a1a1a] w-[750px] max-h-[90vh] rounded-2xl border-2 border-club-accent/50 shadow-[0_0_50px_rgba(255,212,0,0.3)] overflow-hidden flex flex-col animate-[slideUp_0.4s_ease-out]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* HEADER */}
            <div className="relative p-8 border-b border-club-accent/30 bg-gradient-to-r from-club-accent/20 via-club-accent/10 to-transparent overflow-hidden">
              <div className="absolute inset-0 opacity-20">
                <div className="absolute top-0 left-0 w-32 h-32 bg-club-accent rounded-full blur-3xl animate-pulse"></div>
                <div className="absolute bottom-0 right-0 w-40 h-40 bg-club-accent rounded-full blur-3xl animate-pulse delay-700"></div>
              </div>

              <div className="relative z-10 flex justify-between items-start">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-5xl animate-bounce">🎉</span>
                    <h2 className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-club-accent via-yellow-300 to-club-accent animate-gradient">
                      Что нового?
                    </h2>
                  </div>
                  <div className="flex items-center gap-3 ml-1">
                    <span className="text-2xl font-bold text-club-accent drop-shadow-[0_0_10px_rgba(255,212,0,0.5)]">
                      Версия {adminVersion}
                    </span>
                    <span className="text-sm text-gray-400 font-mono">
                      {changelog.date}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* BODY */}
            <div className="flex-1 overflow-y-auto p-8 space-y-6">
              <div className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                <span className="text-2xl">📝</span>
                <span>{changelog.title}</span>
              </div>

              {changelog.changes && changelog.changes.map((change: any, index: number) => {
                const colors = {
                  feature: 'border-green-500 bg-green-500/5',
                  fix: 'border-red-500 bg-red-500/5',
                  improvement: 'border-blue-500 bg-blue-500/5',
                  breaking: 'border-orange-500 bg-orange-500/5',
                };

                const icons = {
                  feature: '✨',
                  fix: '🐛',
                  improvement: '⚡',
                  breaking: '⚠️',
                };

                return (
                  <div
                    key={index}
                    className={`border-l-4 rounded-lg p-4 transition-all duration-300 hover:scale-[1.02] hover:shadow-lg cursor-default ${colors[change.type] || 'border-gray-700'}`}
                    style={{ animationDelay: `${index * 0.1}s` }}
                  >
                    <div className="flex items-start gap-3">
                      <span className="text-2xl flex-shrink-0 mt-1">{icons[change.type] || '📌'}</span>
                      <div className="flex-1">
                        <div className="font-bold text-white mb-2 flex items-center gap-2">
                          <span>{change.title}</span>
                          <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-gray-800 text-gray-400 font-mono">
                            {change.type}
                          </span>
                        </div>
                        <p className="text-sm text-gray-300 leading-relaxed">
                          {change.description}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* FOOTER */}
            <div className="p-6 border-t border-club-accent/30 bg-gradient-to-r from-[#1a1a1a] to-[#222] flex justify-between items-center">
              <div className="text-xs text-gray-500 flex items-center gap-2">
                <span className="animate-pulse">💛</span>
                <span>Сделано с любовью командой DeeMas1k</span>
              </div>
              <button
                onClick={() => setShowChangelog(false)}
                className="bg-gradient-to-r from-club-accent to-yellow-400 hover:from-yellow-400 hover:to-club-accent text-black font-bold py-3 px-10 rounded-lg transition-all duration-300 active:scale-95 cursor-pointer shadow-[0_0_20px_rgba(255,212,0,0.4)] hover:shadow-[0_0_30px_rgba(255,212,0,0.6)] transform hover:scale-105"
              >
                Понятно ✓
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;