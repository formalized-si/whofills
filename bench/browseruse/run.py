"""Runs the real browser-use agent with its own prompts. Args: model use_vision task_file host_rules out_dir."""
import asyncio, json, os, sys
from browser_use import Agent, Browser, ChatOpenAI

async def main():
    model, vision, task_file, rules, out = sys.argv[1:6]
    llm = ChatOpenAI(model=model, base_url="https://ollama.com/v1", api_key=os.environ["OLLAMA_API_KEY"], timeout=200, add_schema_to_system_prompt=True, dont_force_structured_output=True)
    browser = Browser(headless=True, executable_path="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
                      args=[f"--host-resolver-rules={rules}", "--ignore-certificate-errors"], disable_security=True,
                      user_data_dir=os.path.join(out, "profile"), window_size={"width": 1280, "height": 800})
    agent = Agent(task=open(task_file).read(), llm=llm, browser=browser, use_vision=vision == "1", max_failures=3)
    hist = await agent.run(max_steps=40)
    print(json.dumps({"final": hist.final_result() or "", "steps": hist.number_of_steps(), "done": hist.is_done(), "ok": hist.is_successful(), "errors": [e for e in hist.errors() if e][:3]}, default=str))
    await browser.kill() if hasattr(browser, "kill") else None

asyncio.run(main())
