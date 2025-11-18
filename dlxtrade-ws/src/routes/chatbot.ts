import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { logger } from '../utils/logger';
import { z } from 'zod';

// Request schema
const chatbotRequestSchema = z.object({
  message: z.string().min(1).max(2000),
});

export async function chatbotRoutes(fastify: FastifyInstance) {
  // OPTIONS /api/chatbot - CORS preflight
  fastify.options('/chatbot', async (request: FastifyRequest, reply: FastifyReply) => {
    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
    reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return reply.code(204).send();
  });

  // POST /api/chatbot - Send message to Gemini
  fastify.post('/chatbot', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Body: { message: string } }>, reply: FastifyReply) => {
    // Enable CORS
    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
    reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    const user = (request as any).user;
    
    try {
      // Validate request body
      const body = chatbotRequestSchema.parse(request.body);
      
      // Use provided Gemini API key
      const geminiApiKey = 'AIzaSyDTN-xavwahQuTo9jXHO2MzYhJS05sq7fA';
      if (!geminiApiKey) {
        logger.error({ uid: user.uid }, 'GEMINI_API_KEY not configured');
        return reply.code(500).send({
          error: 'Chatbot service is not configured',
          reply: 'Sorry, the chatbot service is not configured. Please contact support.',
        });
      }

      // Import Gemini SDK dynamically
      let GoogleGenerativeAI: any;
      try {
        const geminiModule = await import('@google/generative-ai');
        GoogleGenerativeAI = geminiModule.GoogleGenerativeAI;
      } catch (importError) {
        logger.error({ err: importError }, 'Failed to import @google/generative-ai');
        return reply.code(500).send({
          error: 'Chatbot service dependency not available. Please install @google/generative-ai package.',
          reply: 'Sorry, the chatbot service is currently unavailable. Please try again later.',
        });
      }

      // Initialize Gemini with v1 compatible code
      const genAI = new GoogleGenerativeAI(geminiApiKey);
      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

      // Prepare prompt with context
      const systemPrompt = `You are a helpful AI assistant for DLXTRADE, a cryptocurrency trading platform. 
You help users with questions about trading, the platform features, AI agents, and general cryptocurrency topics.
Be concise, friendly, and professional. If asked about specific trading strategies or financial advice, remind users to do their own research.`;

      const fullPrompt = `${systemPrompt}\n\nUser: ${body.message}\n\nAssistant:`;

      // Call Gemini API
      const startTime = Date.now();
      let text: string;
      try {
        const result = await model.generateContent(fullPrompt);
        const response = await result.response;
        text = response.text();
      } catch (geminiError: any) {
        logger.error({ err: geminiError, uid: user.uid }, 'Gemini API error');
        // Return user-friendly error message
        return reply.code(500).send({
          error: 'Failed to generate response',
          reply: 'Sorry, I encountered an error processing your request. Please try again in a moment.',
        });
      }
      const latency = Date.now() - startTime;

      // Log request (without API key)
      logger.info({
        uid: user.uid,
        messageLength: body.message.length,
        responseLength: text.length,
        latency,
      }, 'Chatbot request processed');

      // Return response with 'reply' field
      return {
        reply: text,
      };
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return reply.code(400).send({
          error: 'Invalid request',
          details: err.errors,
          reply: 'Please provide a valid message (1-2000 characters).',
        });
      }

      logger.error({ err, uid: user.uid }, 'Error processing chatbot request');
      
      // Always return a reply field, even on error
      const errorMessage = err.message || 'Unknown error';
      return reply.code(500).send({
        error: 'Failed to process chatbot request',
        reply: `Sorry, I encountered an error: ${errorMessage}. Please try again.`,
      });
    }
  });
}

