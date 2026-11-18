function StatusMessage({ message, tone = 'info' }) {
  if (!message) return null;

  const styles = {
    info: 'border-[#dce8d6] bg-[#f5f9f2] text-[#526052]',
    success: 'border-[#c8e3ba] bg-[#f2faed] text-[#295f22]',
    error: 'border-[#f1c9c4] bg-[#fff7f5] text-[#922d21]',
  };

  return (
    <p className={`rounded-xl border px-4 py-3 text-sm leading-6 ${styles[tone]}`} role={tone === 'error' ? 'alert' : 'status'}>
      {message}
    </p>
  );
}

export default StatusMessage;
