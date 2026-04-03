import React, { useState, useEffect } from 'react';
import { CheckCircle2, Circle, RefreshCw, ClipboardList, ChevronDown, ChevronUp, Home, Building, FileText, KeyRound, Download, CloudUpload, User, FileSpreadsheet, Plus, LogOut, LogIn, Trash2, Users } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import * as XLSX from 'xlsx';
import { db, auth, signInWithGoogle, logOut } from './firebase';
import { collection, doc, onSnapshot, setDoc, updateDoc, deleteDoc, serverTimestamp, query, orderBy } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { handleFirestoreError, OperationType } from './utils/firestoreErrorHandler';

type Task = {
  id: string;
  title: string;
  description: string;
  completed: boolean;
};

type Phase = {
  id: string;
  title: string;
  iconName: string;
  tasks: Task[];
};

const initialData: Phase[] = [
  {
    id: 'phase-1',
    title: '1. 申込段階',
    iconName: 'home',
    tasks: [
      { id: 't1-1', title: '入居申込', description: '申込書の記入、身分証明書（在留カード/パスポート）の提出', completed: false },
      { id: 't1-2', title: '保証会社審査', description: '保証会社からの電話連絡確認、正式承認の取得', completed: false },
      { id: 't1-3', title: '管理会社連絡', description: '管理会社の特約事項、駐車場などの詳細確認', completed: false },
    ]
  },
  {
    id: 'phase-2',
    title: '2. 準備段階',
    iconName: 'file-text',
    tasks: [
      { id: 't2-1', title: '費用明細作成', description: '日割り家賃、敷金、礼金、仲介手数料、火災保険などの計算', completed: false },
      { id: 't2-2', title: '明細送付・説明', description: '(重要) お客様へ金額、入金期限（例：26日）の確認', completed: false },
      { id: 't2-3', title: '重説(重要事項説明)', description: '作成完了、宅建士の記名押印確認、説明日時の予約', completed: false },
      { id: 't2-4', title: '契約書一式準備', description: '部数の確認、管理規約や特約事項などの添付書類の確認', completed: false },
    ]
  },
  {
    id: 'phase-3',
    title: '3. 契約段階',
    iconName: 'building',
    tasks: [
      { id: 't3-1', title: '契約金入金確認', description: '期日（例：26日）までにお客様の振込が完了しているか確認', completed: false },
      { id: 't3-2', title: '必要書類回収', description: '住民票、印影、顔写真、合格通知書など', completed: false },
      { id: 't3-3', title: '署名・捺印', description: '対面またはIT重説（Zoom）＋郵送', completed: false },
      { id: 't3-4', title: '保険加入手続き', description: '火災保険のオンライン決済または申込書記入が完了しているか確認', completed: false },
    ]
  },
  {
    id: 'phase-4',
    title: '4. 引渡段階',
    iconName: 'key-round',
    tasks: [
      { id: 't4-1', title: '鍵の引渡し準備', description: '管理会社から鍵を受領（通常は契約日または入居日当日）', completed: false },
      { id: 't4-2', title: 'ライフライン案内', description: '電気、ガス、水道の開通案内（特にオール電化物件）', completed: false },
      { id: 't4-3', title: '入居説明', description: 'ゴミ出しルールの説明（倶知安/ニセコ/札幌ルール）、室内チェック表の案内', completed: false },
    ]
  }
];

const renderIcon = (iconName: string) => {
  switch (iconName) {
    case 'home': return <Home className="w-5 h-5" />;
    case 'file-text': return <FileText className="w-5 h-5" />;
    case 'building': return <Building className="w-5 h-5" />;
    case 'key-round': return <KeyRound className="w-5 h-5" />;
    default: return <ClipboardList className="w-5 h-5" />;
  }
};

export default function App() {
  const [user, setUser] = useState<any>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  
  const [checklists, setChecklists] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState('');

  const [expandedPhases, setExpandedPhases] = useState<Record<string, boolean>>({
    'phase-1': true,
    'phase-2': true,
    'phase-3': true,
    'phase-4': true,
  });

  // Modal states
  const [modalConfig, setModalConfig] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    type: 'alert' | 'confirm' | 'prompt';
    inputValue?: string;
    onConfirm?: (val?: string) => void;
    onCancel?: () => void;
  }>({ isOpen: false, title: '', message: '', type: 'alert' });

  const showAlert = (title: string, message: string) => {
    setModalConfig({ isOpen: true, title, message, type: 'alert', onConfirm: () => setModalConfig(prev => ({ ...prev, isOpen: false })) });
  };

  const showConfirm = (title: string, message: string, onConfirm: () => void) => {
    setModalConfig({
      isOpen: true, title, message, type: 'confirm',
      onConfirm: () => { onConfirm(); setModalConfig(prev => ({ ...prev, isOpen: false })); },
      onCancel: () => setModalConfig(prev => ({ ...prev, isOpen: false }))
    });
  };

  const showPrompt = (title: string, message: string, onConfirm: (val: string) => void) => {
    setModalConfig({
      isOpen: true, title, message, type: 'prompt', inputValue: '',
      onConfirm: (val) => { onConfirm(val || ''); setModalConfig(prev => ({ ...prev, isOpen: false })); },
      onCancel: () => setModalConfig(prev => ({ ...prev, isOpen: false }))
    });
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!isAuthReady || !user) {
      setChecklists([]);
      return;
    }

    const q = query(collection(db, 'checklists'), orderBy('updatedAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          phases: JSON.parse(data.phasesData)
        };
      });
      setChecklists(list);
      
      if (list.length > 0 && !selectedId) {
        setSelectedId(list[0].id);
      } else if (list.length === 0) {
        setSelectedId(null);
      }
    }, (error) => {
      console.error("Snapshot error:", error);
      showAlert('読み込みエラー', 'データの取得に失敗しました: ' + error.message);
    });

    return () => unsubscribe();
  }, [isAuthReady, user]);

  const handleAddCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCustomerName.trim() || !user) return;

    try {
      const newRef = doc(collection(db, 'checklists'));
      await setDoc(newRef, {
        customerName: newCustomerName.trim(),
        phasesData: JSON.stringify(initialData),
        createdBy: user.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      setNewCustomerName('');
      setSelectedId(newRef.id);
    } catch (error) {
      console.error("Add customer error:", error);
      showAlert('エラー', '追加に失敗しました: ' + (error instanceof Error ? error.message : String(error)));
    }
  };

  const handleDeleteCustomer = async (id: string, name: string) => {
    showConfirm('削除の確認', `本当に「${name}」のデータを削除しますか？`, async () => {
      try {
        await deleteDoc(doc(db, 'checklists', id));
        if (selectedId === id) setSelectedId(null);
      } catch (error) {
        console.error("Delete customer error:", error);
        showAlert('エラー', '削除に失敗しました: ' + (error instanceof Error ? error.message : String(error)));
      }
    });
  };

  const updatePhases = async (id: string, newPhases: Phase[]) => {
    try {
      await updateDoc(doc(db, 'checklists', id), {
        phasesData: JSON.stringify(newPhases),
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      console.error("Update phases error:", error);
      showAlert('エラー', '更新に失敗しました: ' + (error instanceof Error ? error.message : String(error)));
    }
  };

  const selectedChecklist = checklists.find(c => c.id === selectedId);

  const toggleTask = (phaseId: string, taskId: string) => {
    if (!selectedChecklist) return;
    const newPhases = selectedChecklist.phases.map((phase: Phase) => {
      if (phase.id === phaseId) {
        return {
          ...phase,
          tasks: phase.tasks.map(task => 
            task.id === taskId ? { ...task, completed: !task.completed } : task
          )
        };
      }
      return phase;
    });
    updatePhases(selectedChecklist.id, newPhases);
  };

  const togglePhase = (phaseId: string) => {
    setExpandedPhases(prev => ({
      ...prev,
      [phaseId]: !prev[phaseId]
    }));
  };

  const resetProgress = () => {
    if (!selectedChecklist) return;
    showConfirm('リセットの確認', 'すべての進捗をリセットしてもよろしいですか？', () => {
      updatePhases(selectedChecklist.id, initialData);
    });
  };

  const generateExcelWorkbook = () => {
    if (!selectedChecklist) return null;
    const data: any[] = [];
    selectedChecklist.phases.forEach((phase: Phase) => {
      phase.tasks.forEach(task => {
        data.push({
          '段階': phase.title,
          'タスク': task.title,
          '状態': task.completed ? '完了' : '未完了',
          '詳細': task.description
        });
      });
    });
    
    const worksheet = XLSX.utils.json_to_sheet(data);
    worksheet['!cols'] = [{ wch: 15 }, { wch: 25 }, { wch: 10 }, { wch: 60 }];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "進捗状況");
    return workbook;
  };

  const downloadExcel = () => {
    const workbook = generateExcelWorkbook();
    if (!workbook || !selectedChecklist) return;
    const fileName = `${selectedChecklist.customerName}様_賃貸契約進捗.xlsx`;
    XLSX.writeFile(workbook, fileName);
  };

  const uploadToDropbox = async () => {
    if (!selectedChecklist) return;
    
    showPrompt('Dropbox連携', 'Dropboxのアクセストークンを入力してください:\n(※初回のみ。開発者コンソールで取得したトークン)', async (token) => {
      if (!token) return;

      setIsUploading(true);
      const workbook = generateExcelWorkbook();
      if (!workbook) {
        setIsUploading(false);
        return;
      }
      const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
      const fileName = `${selectedChecklist.customerName}様_賃貸契約進捗.xlsx`;
      
      try {
        const response = await fetch('https://content.dropboxapi.com/2/files/upload', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Dropbox-API-Arg': JSON.stringify({
              path: `/${fileName}`,
              mode: 'overwrite',
              autorename: true,
              mute: false
            }),
            'Content-Type': 'application/octet-stream'
          },
          body: excelBuffer
        });

        if (response.ok) {
          showAlert('成功', `✅ Dropboxへの保存が成功しました！\nファイル名: ${fileName}`);
        } else {
          const err = await response.text();
          showAlert('エラー', `❌ エラーが発生しました:\n${err}`);
        }
      } catch (error) {
        showAlert('エラー', `❌ ネットワークエラー:\n${error}`);
      } finally {
        setIsUploading(false);
      }
    });
  };

  if (!isAuthReady) {
    return <div className="min-h-screen flex items-center justify-center bg-slate-50">読み込み中...</div>;
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
        <div className="max-w-md w-full bg-white rounded-xl shadow-sm border border-slate-200 p-8 text-center">
          <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-6">
            <Users className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold text-slate-800 mb-2">チーム共有版</h1>
          <p className="text-slate-500 mb-8">チームメンバーとリアルタイムで進捗を共有・管理できます。</p>
          <button
            onClick={signInWithGoogle}
            className="w-full flex items-center justify-center space-x-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-3 rounded-lg font-medium transition-colors"
          >
            <LogIn className="w-5 h-5" />
            <span>Googleでログイン</span>
          </button>
        </div>
      </div>
    );
  }

  const totalTasks = selectedChecklist ? selectedChecklist.phases.reduce((acc: number, phase: Phase) => acc + phase.tasks.length, 0) : 0;
  const completedTasks = selectedChecklist ? selectedChecklist.phases.reduce((acc: number, phase: Phase) => 
    acc + phase.tasks.filter(t => t.completed).length, 0
  ) : 0;
  const progressPercentage = totalTasks === 0 ? 0 : Math.round((completedTasks / totalTasks) * 100);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans flex">
      {/* Modal Overlay */}
      <AnimatePresence>
        {modalConfig.isOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-xl shadow-xl max-w-md w-full overflow-hidden"
            >
              <div className="p-6">
                <h3 className="text-lg font-bold text-slate-800 mb-2">{modalConfig.title}</h3>
                <p className="text-slate-600 mb-6 whitespace-pre-wrap">{modalConfig.message}</p>
                
                {modalConfig.type === 'prompt' && (
                  <input 
                    type="text" 
                    autoFocus
                    value={modalConfig.inputValue}
                    onChange={(e) => setModalConfig(prev => ({ ...prev, inputValue: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-md mb-6 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="トークンを入力..."
                  />
                )}

                <div className="flex justify-end space-x-3">
                  {modalConfig.type !== 'alert' && (
                    <button 
                      onClick={modalConfig.onCancel}
                      className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-md transition-colors"
                    >
                      キャンセル
                    </button>
                  )}
                  <button 
                    onClick={() => modalConfig.onConfirm?.(modalConfig.inputValue)}
                    className="px-4 py-2 bg-blue-600 text-white hover:bg-blue-700 rounded-md transition-colors"
                  >
                    OK
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-slate-200 flex flex-col h-screen sticky top-0">
        <div className="p-4 border-b border-slate-200">
          <div className="flex items-center space-x-2 mb-4">
            <div className="bg-blue-600 p-1.5 rounded text-white">
              <ClipboardList className="w-5 h-5" />
            </div>
            <h1 className="font-bold text-slate-800">賃貸契約管理</h1>
          </div>
          
          <form onSubmit={handleAddCustomer} className="flex space-x-2">
            <input
              type="text"
              value={newCustomerName}
              onChange={(e) => setNewCustomerName(e.target.value)}
              placeholder="新規お客様名"
              className="flex-1 min-w-0 px-3 py-1.5 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              type="submit"
              disabled={!newCustomerName.trim()}
              className="p-1.5 bg-blue-50 text-blue-600 rounded-md hover:bg-blue-100 disabled:opacity-50 transition-colors"
            >
              <Plus className="w-5 h-5" />
            </button>
          </form>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {checklists.map(checklist => (
            <div
              key={checklist.id}
              className={`group flex items-center justify-between px-3 py-2 rounded-md cursor-pointer transition-colors ${
                selectedId === checklist.id ? 'bg-blue-50 text-blue-700' : 'hover:bg-slate-50 text-slate-700'
              }`}
              onClick={() => setSelectedId(checklist.id)}
            >
              <div className="flex items-center space-x-2 truncate">
                <User className="w-4 h-4 flex-shrink-0" />
                <span className="text-sm font-medium truncate">{checklist.customerName}</span>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteCustomer(checklist.id, checklist.customerName);
                }}
                className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-red-500 transition-opacity"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
          {checklists.length === 0 && (
            <div className="p-4 text-center text-sm text-slate-500">
              お客様が登録されていません
            </div>
          )}
        </div>

        <div className="p-4 border-t border-slate-200">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2 truncate">
              <img src={user.photoURL || ''} alt="" className="w-8 h-8 rounded-full bg-slate-200" />
              <span className="text-sm font-medium truncate">{user.displayName}</span>
            </div>
            <button
              onClick={logOut}
              className="p-1.5 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-md transition-colors"
              title="ログアウト"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-screen overflow-y-auto">
        {selectedChecklist ? (
          <>
            <header className="bg-white border-b border-slate-200 sticky top-0 z-10 shadow-sm px-8 py-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-bold text-slate-800">{selectedChecklist.customerName}様</h2>
                  <p className="text-sm text-slate-500 mt-1">リアルタイム同期中</p>
                </div>
                
                <div className="flex items-center space-x-2">
                  <button 
                    onClick={downloadExcel}
                    className="flex items-center space-x-1 text-sm bg-green-50 border border-green-200 text-green-700 hover:bg-green-100 transition-colors px-3 py-1.5 rounded-md shadow-sm"
                    title="Excelとしてダウンロード"
                  >
                    <FileSpreadsheet className="w-4 h-4" />
                    <span className="hidden sm:inline">Excel出力</span>
                  </button>
                  
                  <button 
                    onClick={uploadToDropbox}
                    disabled={isUploading}
                    className="flex items-center space-x-1 text-sm bg-blue-50 border border-blue-200 text-blue-700 hover:bg-blue-100 transition-colors px-3 py-1.5 rounded-md shadow-sm disabled:opacity-50"
                    title="Dropboxへ直接保存"
                  >
                    <CloudUpload className="w-4 h-4" />
                    <span className="hidden sm:inline">{isUploading ? '保存中...' : 'Dropbox保存'}</span>
                  </button>

                  <button 
                    onClick={resetProgress}
                    className="flex items-center space-x-1 text-sm text-slate-500 hover:text-red-600 transition-colors px-3 py-1.5 rounded-md hover:bg-red-50"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="mt-6">
                <div className="flex justify-between items-end mb-2">
                  <span className="text-sm font-medium text-slate-600">全体の進捗</span>
                  <span className="text-2xl font-bold text-blue-600">{progressPercentage}%</span>
                </div>
                <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden border border-slate-200">
                  <motion.div 
                    className="bg-blue-600 h-3 rounded-full"
                    initial={{ width: 0 }}
                    animate={{ width: `${progressPercentage}%` }}
                    transition={{ duration: 0.5, ease: "easeOut" }}
                  />
                </div>
                <p className="text-xs text-slate-500 mt-2 text-right">
                  {completedTasks} / {totalTasks} タスク完了
                </p>
              </div>
            </header>

            <div className="p-8 max-w-3xl mx-auto w-full space-y-6">
              {selectedChecklist.phases.map((phase: Phase) => {
                const phaseCompletedTasks = phase.tasks.filter(t => t.completed).length;
                const phaseTotalTasks = phase.tasks.length;
                const isPhaseComplete = phaseCompletedTasks === phaseTotalTasks;
                const isExpanded = expandedPhases[phase.id];

                return (
                  <div 
                    key={phase.id} 
                    className={`bg-white rounded-xl shadow-sm border overflow-hidden transition-colors duration-300 ${
                      isPhaseComplete ? 'border-green-200 bg-green-50/30' : 'border-slate-200'
                    }`}
                  >
                    <button 
                      onClick={() => togglePhase(phase.id)}
                      className="w-full px-5 py-4 flex items-center justify-between hover:bg-slate-50 transition-colors text-left"
                    >
                      <div className="flex items-center space-x-3">
                        <div className={`p-2 rounded-lg ${isPhaseComplete ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                          {renderIcon(phase.iconName)}
                        </div>
                        <div>
                          <h2 className="text-lg font-bold text-slate-800">{phase.title}</h2>
                          <p className="text-sm text-slate-500 mt-0.5">
                            進捗: {phaseCompletedTasks}/{phaseTotalTasks}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center space-x-4">
                        {isPhaseComplete && (
                          <span className="text-xs font-medium bg-green-100 text-green-700 px-2.5 py-1 rounded-full">
                            完了
                          </span>
                        )}
                        <div className="text-slate-400">
                          {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                        </div>
                      </div>
                    </button>

                    <AnimatePresence initial={false}>
                      {isExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.3, ease: "easeInOut" }}
                          className="overflow-hidden"
                        >
                          <div className="border-t border-slate-100 px-2 pb-2 pt-1">
                            {phase.tasks.map((task) => (
                              <div 
                                key={task.id}
                                onClick={() => toggleTask(phase.id, task.id)}
                                className={`group flex items-start space-x-4 p-3 m-1 rounded-lg cursor-pointer transition-all duration-200 ${
                                  task.completed 
                                    ? 'bg-slate-50 hover:bg-slate-100' 
                                    : 'hover:bg-blue-50/50'
                                }`}
                              >
                                <div className="flex-shrink-0 mt-0.5">
                                  {task.completed ? (
                                    <motion.div
                                      initial={{ scale: 0.8 }}
                                      animate={{ scale: 1 }}
                                      transition={{ type: "spring", stiffness: 300, damping: 20 }}
                                    >
                                      <CheckCircle2 className="w-6 h-6 text-green-500" />
                                    </motion.div>
                                  ) : (
                                    <Circle className="w-6 h-6 text-slate-300 group-hover:text-blue-400 transition-colors" />
                                  )}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className={`text-base font-medium transition-colors duration-200 ${
                                    task.completed ? 'text-slate-500 line-through' : 'text-slate-800'
                                  }`}>
                                    {task.title}
                                  </p>
                                  <p className={`text-sm mt-1 transition-colors duration-200 ${
                                    task.completed ? 'text-slate-400' : 'text-slate-600'
                                  }`}>
                                    {task.description}
                                  </p>
                                </div>
                              </div>
                            ))}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-slate-400">
            <div className="text-center">
              <ClipboardList className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>左側のメニューからお客様を選択するか、<br/>新しく追加してください。</p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
