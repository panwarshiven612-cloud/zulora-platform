import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import Groq from 'groq-sdk';

// This line fixes the "Module" error by forcing Next.js to see this as a route
export const dynamic = 'force-dynamic';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { prompt } = body;

    if (!prompt) {
      return NextResponse.json({ error: "No prompt provided" }, { status: 400 });
    }

    const SYSTEM_PROMPT = `
      ROLE: Elite Web Developer.
      TASK: Create a single-file HTML website using Tailwind CSS.
      OUTPUT: Return ONLY raw HTML. No markdown.
    `;

    // Try OpenAI
    try {
      const completion = await openai.chat.completions.create({
        messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: prompt }],
        model: "gpt-4-turbo",
      });
      return NextResponse.json({ success: true, code: completion.choices[0].message.content });
    } catch (e) {
      console.log("OpenAI Failed, trying backup...");
      // Try Groq (Backup)
      try {
         const gCompletion = await groq.chat.completions.create({
             messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: prompt }],
             model: "mixtral-8x7b-32768",
         });
         return NextResponse.json({ success: true, code: gCompletion.choices[0]?.message?.content });
      } catch (e2) {
         return NextResponse.json({ error: "AI Service Overload" }, { status: 500 });
      }
    }
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}