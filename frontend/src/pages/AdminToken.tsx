import { useEffect, useState } from "react";
import { auth } from "../config/firebase";
import { adminApi } from "../services/api";

export default function AdminTokenPage() {
  const [token, setToken] = useState("");
  const [status, setStatus] = useState("Generating token…");

  const promote = async (idToken: string) => {
    setStatus("Sending promote request…");
    try {
      const response = await adminApi.promote("sourav23065398@gmail.com");

      const data = response.data;
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
    if (!auth.currentUser) {
      setStatus("❌ No logged-in user");
      return;
    }
    const freshToken = await auth.currentUser.getIdToken();
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

