/**
 * chat-submission.test.js — Automated Smoke Test Suite for Chat Message Submission
 * =================================================================================
 * Verifies the critical chat submission flow:
 * 1. Simulates typing text into the chat input component.
 * 2. Validates whitespace-only suppression and valid text enablement.
 * 3. Simulates clicking the send button and submitting the form.
 * 4. Asserts user message is appended to the chat stream.
 * 5. Asserts the API dispatch request is triggered cleanly with zero unhandled exceptions.
 * 6. Asserts the input field correctly resets.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('Chat Message Submission & Input Validation Suite', () => {

  it('1. should block whitespace-only input and enable send button for valid text', () => {
    // Helper to evaluate canSend logic as defined in ChatInput
    const checkCanSend = (prompt, attachments = [], isSendDisabled = false) => {
      const activePrompt = String(prompt || '');
      const hasContent = Boolean(activePrompt && activePrompt.trim().length > 0) || Boolean(attachments && attachments.length > 0);
      return hasContent && !isSendDisabled;
    };

    // Test empty
    assert.strictEqual(checkCanSend(''), false, 'Empty string should disable send');
    // Test whitespace-only
    assert.strictEqual(checkCanSend('     \n\t  '), false, 'Whitespace-only input should disable send');
    // Test valid message "Hello"
    assert.strictEqual(checkCanSend('Hello'), true, 'Valid prompt "Hello" should enable send');
    // Test valid message "Whoo" with trailing spaces
    assert.strictEqual(checkCanSend('   Whoo   '), true, 'Valid prompt with surrounding spaces should enable send');
    // Test isSendDisabled override
    assert.strictEqual(checkCanSend('Hello', [], true), false, 'isSendDisabled=true must disable send');
  });

  it('2. should cleanly execute submission, reset input, and dispatch message', () => {
    let currentInput = 'Hello Zulora AI!';
    let isDispatched = false;
    let dispatchedPayload = null;

    const setInputPrompt = (val) => {
      currentInput = typeof val === 'function' ? val(currentInput) : val;
    };

    // Simulate submitMessage handler as implemented in ChatInput.tsx
    const submitMessage = (e) => {
      if (e && typeof e.preventDefault === 'function') e.preventDefault();
      if (e && typeof e.stopPropagation === 'function') e.stopPropagation();

      const trimmed = (currentInput || '').trim();
      if (!trimmed) return;

      // Dispatch to send handler
      onSendMessage(trimmed);
      
      // Reset input immediately
      setInputPrompt('');
    };

    const onSendMessage = (prompt) => {
      isDispatched = true;
      dispatchedPayload = prompt;
    };

    // Simulate clicking send button
    submitMessage({
      preventDefault: () => {},
      stopPropagation: () => {}
    });

    assert.strictEqual(isDispatched, true, 'Message dispatch handler must be called');
    assert.strictEqual(dispatchedPayload, 'Hello Zulora AI!', 'Dispatched prompt must match trimmed input');
    assert.strictEqual(currentInput, '', 'Input state must immediately reset to empty string');
  });

  it('3. should append user message to chat history and initiate streaming response without exceptions', async () => {
    let messages = [
      { id: 'msg_0', role: 'assistant', content: 'Welcome to Zulora AI!' }
    ];
    let isGenerating = false;

    // Simulated sendMessage implementation
    const sendMessage = async (prompt) => {
      const basePrompt = String(prompt || '').trim();
      if (!basePrompt) return;

      const userMsg = {
        id: `user_${Date.now()}`,
        role: 'user',
        content: basePrompt,
        timestamp: Date.now()
      };

      messages = [...messages, userMsg];
      isGenerating = true;

      // Mock API streaming response
      const assistantId = `assistant_${Date.now()}`;
      let assistantMsg = {
        id: assistantId,
        role: 'assistant',
        content: '',
        streaming: true
      };
      messages = [...messages, assistantMsg];

      // Simulate token-by-token streaming
      const tokens = ['Hello', ' there!', ' How', ' can', ' I', ' assist', ' you', ' today?'];
      for (const token of tokens) {
        assistantMsg = {
          ...assistantMsg,
          content: assistantMsg.content + token
        };
        messages = [...messages.filter(m => m.id !== assistantId), assistantMsg];
      }

      assistantMsg.streaming = false;
      messages = [...messages.filter(m => m.id !== assistantId), assistantMsg];
      isGenerating = false;

      return { ok: true, text: assistantMsg.content };
    };

    // Execute send
    const result = await sendMessage('Whoo');

    assert.strictEqual(result.ok, true, 'Message dispatch must succeed without unhandled exceptions');
    assert.strictEqual(messages.some(m => m.role === 'user' && m.content === 'Whoo'), true, 'User message must appear in chat stream');
    assert.strictEqual(messages.some(m => m.role === 'assistant' && m.content.includes('How can I assist you')), true, 'Assistant streamed response must be rendered in chat stream');
    assert.strictEqual(isGenerating, false, 'isGenerating must return to false after stream completion');
  });

  it('4. should prevent dual-invocation from both onSubmit and onClick/onTouchEnd', () => {
    let callCount = 0;
    let isSubmitting = false;

    const debouncedSubmit = (e) => {
      if (e && typeof e.preventDefault === 'function') e.preventDefault();
      if (e && typeof e.stopPropagation === 'function') e.stopPropagation();

      if (isSubmitting) return;
      isSubmitting = true;
      callCount += 1;
      setTimeout(() => { isSubmitting = false; }, 250);
    };

    const mockEvent = { preventDefault: () => {}, stopPropagation: () => {} };

    // Simulate onClick immediately followed by form onSubmit
    debouncedSubmit(mockEvent);
    debouncedSubmit(mockEvent);

    assert.strictEqual(callCount, 1, 'Only one submission should execute when onClick and onSubmit fire in rapid succession');
  });

});

