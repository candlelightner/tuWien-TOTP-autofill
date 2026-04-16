async function restoreOptions() {
  const data = await browser.storage.local.get({
    otpauth: ""
  });

  document.getElementById("otpauth").value = data.otpauth;
}

async function saveOptions() {
  const otpauth = document.getElementById("otpauth").value.trim();

  await browser.storage.local.set({
    otpauth
  });

  const status = document.getElementById("status");
  status.textContent = "Gespeichert.";
  setTimeout(() => {
    status.textContent = "";
  }, 1500);
}

document.addEventListener("DOMContentLoaded", restoreOptions);
document.getElementById("save").addEventListener("click", saveOptions);