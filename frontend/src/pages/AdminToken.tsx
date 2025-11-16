import { useEffect, useState } from "react";
import { getAuth } from "firebase/auth";

export default function AdminTokenPage() {
  const [token, setToken] = useState("");
  const [status, setStatus] = useState("Generating token…");

  const promote = async (idToken: string) => {
    setStatus("Sending promote request…");
    try {
      const response = await fetch("http://localhost:4000/api/admin/promote", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${idToken}`,
          "x-admin-setup": "SUPER-SECRET-998877",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: "sourav23065398@gmail.com"
        }),
      });

      const data = await response.json();
      console.log("PROMOTE RESPONSE:", data);

      if (response.ok) {
        setStatus("✅ ADMIN PROMOTED SUCCESSFULLY");
      } else {
        setStatus("❌ ERROR: " + (data.error || "Unknown error"));
      }
    } catch (err: any) {
      setStatus("❌ REQUEST FAILED: " + err.message);
    }
  };

  const generateToken = async () => {
    const auth = getAuth();
    if (!auth.currentUser) {
      setStatus("❌ No logged-in user");
      return;
    }
    const freshToken = await auth.currentUser.getIdToken(true);
    setToken(freshToken);
    setStatus("Token generated. Running promote…");
    promote(freshToken);
  };

  useEffect(() => {
    generateToken();
  }, []);

  return (
    <div style={{ padding: 40 }}>
      <h1>Admin Promotion Tool</h1>
      <p>Status: {status}</p>
      <textarea
        value={token}
        readOnly
        style={{ width: "100%", height: 160, marginTop: 20 }}
      />
      <button style={{ marginTop: 20 }} onClick={generateToken}>
        Run Promote Again
      </button>
    </div>
  );
}

