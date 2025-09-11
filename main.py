from dotenv import load_dotenv
load_dotenv()

import supabase_api
import groq_api
import openmeteo_api

# === Pipeline =======================================================
def main():
    # === get supabase access token
    access_token = supabase_api.get_access_token()
   
    # === process raw SMS to json data, and import openmeteo data
    rows = supabase_api.rpc_get_unprocessed(limit=10, access_token=access_token)
    if not rows:
        print("Geen nieuwe rijen.")
        return
    
    for row in rows:
        value_processed_body = groq_api.groq_process_text(row["body"])
        value_openmeteo = openmeteo_api.get_openmeteo_data()  

        # Als je kolom jsonb is:
        supabase_api.rpc_set_body_processed(row["id"], value_processed_body, access_token=access_token, as_text=False)
        supabase_api.rpc_set_openmeteo(row["id"], value_openmeteo, access_token=access_token)

        # Als je kolom text is, gebruik:
        # rpc_set_body_processed(row["id"], value, access_token=access_token, as_text=True)

        print(f"Updated row {row['id']}")

if __name__ == "__main__":
    main()
