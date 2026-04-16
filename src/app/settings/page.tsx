'use client';

import { useState, useEffect, useCallback } from 'react';
import { Upload, FileText, Check, User } from 'lucide-react';

export default function SettingsPage() {
  const [userName, setUserName] = useState('');
  const [resumeFileName, setResumeFileName] = useState<string | null>(null);
  const [resumeText, setResumeText] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((data) => {
        setUserName(data.settings.userName || '');
      });
    fetch('/api/resume')
      .then((r) => r.json())
      .then((data) => {
        setResumeFileName(data.fileName);
        setResumeText(data.text);
      });
  }, []);

  const uploadFile = useCallback(async (file: File) => {
    setUploading(true);
    setMessage(null);
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await fetch('/api/resume', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setResumeFileName(data.fileName);
      setResumeText(data.text);
      setMessage({ type: 'success', text: 'Resume uploaded and parsed successfully!' });
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Upload failed' });
    } finally {
      setUploading(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) uploadFile(file);
    },
    [uploadFile]
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) uploadFile(file);
    },
    [uploadFile]
  );

  const saveName = async () => {
    setSaving(true);
    await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userName }),
    });
    setSaving(false);
    setMessage({ type: 'success', text: 'Name saved!' });
    setTimeout(() => setMessage(null), 2000);
  };

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-8">Settings</h1>

      {message && (
        <div
          className={`mb-6 p-4 rounded-lg text-sm font-medium ${
            message.type === 'success'
              ? 'bg-green-50 text-green-700 border border-green-200'
              : 'bg-red-50 text-red-700 border border-red-200'
          }`}
        >
          {message.text}
        </div>
      )}

      {/* User Name */}
      <section className="mb-8 bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center gap-3 mb-4">
          <User className="w-5 h-5 text-gray-500" />
          <h2 className="text-lg font-semibold text-gray-900">Your Name</h2>
        </div>
        <div className="flex gap-3">
          <input
            type="text"
            value={userName}
            onChange={(e) => setUserName(e.target.value)}
            placeholder="Enter your name"
            className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
          />
          <button
            onClick={saveName}
            disabled={saving}
            className="px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </section>

      {/* Resume Upload */}
      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center gap-3 mb-4">
          <FileText className="w-5 h-5 text-gray-500" />
          <h2 className="text-lg font-semibold text-gray-900">Resume</h2>
        </div>

        {resumeFileName && (
          <div className="flex items-center gap-2 mb-4 p-3 bg-green-50 border border-green-200 rounded-lg">
            <Check className="w-4 h-4 text-green-600" />
            <span className="text-sm text-green-700 font-medium">
              Current: {resumeFileName}
            </span>
          </div>
        )}

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          className={`border-2 border-dashed rounded-xl p-10 text-center transition-colors ${
            dragOver
              ? 'border-blue-500 bg-blue-50'
              : 'border-gray-300 hover:border-gray-400'
          }`}
        >
          <Upload className="w-10 h-10 text-gray-400 mx-auto mb-3" />
          <p className="text-sm text-gray-600 mb-2">
            {uploading ? 'Uploading...' : 'Drag and drop your resume here, or'}
          </p>
          <label className="inline-block px-5 py-2.5 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg cursor-pointer hover:bg-gray-200 transition-colors">
            Browse Files
            <input
              type="file"
              accept=".docx,.pdf"
              onChange={handleFileInput}
              className="hidden"
            />
          </label>
          <p className="text-xs text-gray-400 mt-2">Supports .docx and .pdf</p>
        </div>

        {/* Resume text preview */}
        {resumeText && (
          <div className="mt-6">
            <h3 className="text-sm font-semibold text-gray-700 mb-2">
              Parsed Resume Preview
            </h3>
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 max-h-80 overflow-y-auto">
              <pre className="text-xs text-gray-600 whitespace-pre-wrap font-mono leading-relaxed">
                {resumeText.slice(0, 3000)}
                {resumeText.length > 3000 && '\n\n... (truncated)'}
              </pre>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
