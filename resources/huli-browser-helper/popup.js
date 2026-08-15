const LABELS = { idle: "Chưa ghép nối", connected: "Đã kết nối", working: "Đang đọc trang", disconnected: "Mất kết nối — đang thử lại", error: "Có lỗi" };
async function render() {
  const { helperStatus } = await chrome.storage.session.get("helperStatus");
  document.querySelector("#status").textContent = LABELS[helperStatus?.status] ?? LABELS.idle;
  document.querySelector("#detail").textContent = helperStatus?.detail ?? "Mở Tool Dịch Truyện và bấm kết nối Huliwang.";
  document.querySelector("#disconnect").disabled = !helperStatus || helperStatus.status === "idle";
}
document.querySelector("#disconnect").addEventListener("click", () => { chrome.runtime.sendMessage({ type: "disconnect" }); setTimeout(render, 100); });
chrome.storage.onChanged.addListener(render);
void render();
