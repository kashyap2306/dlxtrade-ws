import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { logger } from '../utils/logger';
import { z } from 'zod';
import axios from 'axios';

// Request schema
const chatbotRequestSchema = z.object({
  message: z.string().min(1).max(2000),
});

/**
 * Call Gemini API directly via HTTP (fallback if SDK not available)
 */
async function callGeminiAPIHttp(apiKey: string, prompt: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
  
  const response = await axios.post(
    url,
    {
      contents: [{
        parts: [{
          text: prompt,
        }],
      }],
    },
    {
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 30000, // 30 second timeout
    }
  );

  if (!response.data || !response.data.candidates || !response.data.candidates[0]) {
    throw new Error('Invalid response from Gemini API');
  }

  const candidate = response.data.candidates[0];
  if (!candidate.content || !candidate.content.parts || !candidate.content.parts[0]) {
    throw new Error('No text content in Gemini response');
  }

  return candidate.content.parts[0].text || '';
}

export async function chatbotRoutes(fastify: FastifyInstance) {
  // Test endpoint to verify route is working
  fastify.get('/chatbot/test', async (request: FastifyRequest, reply: FastifyReply) => {
    return { status: 'ok', message: 'Chatbot route is working' };
  });

  // OPTIONS /api/chatbot - CORS preflight
  fastify.options('/chatbot', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      reply.header('Access-Control-Allow-Origin', '*');
      reply.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
      reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      return reply.code(204).send();
    } catch (err: any) {
      logger.error({ err }, 'Error in chatbot OPTIONS handler');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  // POST /api/chatbot - Send message to Gemini
  fastify.post('/chatbot', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    // Wrap entire handler in try-catch to catch any errors from preHandler or handler
    try {
      // Enable CORS first
      reply.header('Access-Control-Allow-Origin', '*');
      reply.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
      reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      
      // Get user from request (set by authenticate middleware)
      let user: any;
      try {
        user = (request as any).user;
      } catch (err: any) {
        logger.error({ err }, 'Error accessing user from request');
        return reply.code(500).send({
          error: 'Internal server error',
          reply: 'Sorry, I encountered an error processing your request. Please try again.',
        });
      }
      
      if (!user || !user.uid) {
        logger.warn('Chatbot request without valid user');
        return reply.code(401).send({
          error: 'Unauthorized',
          reply: 'Please log in to use the chatbot.',
        });
      }
      
      try {
        // Safely parse request body
        const requestBody = request.body as any;
        if (!requestBody || typeof requestBody !== 'object') {
          return reply.code(400).send({
            error: 'Invalid request body',
            reply: 'Please provide a valid message in the request body.',
          });
        }

        // Validate request body
        const body = chatbotRequestSchema.parse(requestBody);
        
        // Use Gemini API key from environment variable
        const geminiApiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
        if (!geminiApiKey || geminiApiKey.trim() === '') {
          logger.error({ uid: user.uid, hasEnvKey: !!process.env.GEMINI_API_KEY }, 'GEMINI_API_KEY not configured');
          return reply.code(500).send({
            error: 'Chatbot service is not configured',
            reply: 'Sorry, the chatbot service is not configured. Please contact support.',
          });
        }

        // Prepare prompt with context
        const systemPrompt = `You are a helpful AI assistant for DLXTRADE, a cryptocurrency trading platform. 
You help users with questions about trading, the platform features, AI agents, and general cryptocurrency topics.
Be concise, friendly, and professional. If asked about specific trading strategies or financial advice, remind users to do their own research.`;

        const fullPrompt = `${systemPrompt}\n\nUser: ${body.message}\n\nAssistant:`;

        // Try SDK first, fallback to HTTP
        let text: string;
        const startTime = Date.now();
        let useHttpFallback = false;

        try {
          // Try to use SDK if available
          logger.info({ uid: user.uid }, 'Attempting to use Gemini SDK');
          const geminiModule = await import('@google/generative-ai');
          const GoogleGenerativeAI = geminiModule?.GoogleGenerativeAI || geminiModule?.default?.GoogleGenerativeAI;
          
          if (GoogleGenerativeAI) {
            const genAI = new GoogleGenerativeAI(geminiApiKey);
            const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
            
            logger.info({ uid: user.uid, messageLength: body.message.length }, 'Calling Gemini API via SDK');
            const result = await model.generateContent(fullPrompt);
            const response = await result.response;
            text = response.text();
            
            if (!text || typeof text !== 'string') {
              throw new Error('Invalid response text from Gemini API');
            }
            
            logger.info({ uid: user.uid, responseLength: text.length }, 'Gemini API call successful via SDK');
          } else {
            throw new Error('GoogleGenerativeAI not available');
          }
        } catch (sdkError: any) {
          // If SDK fails, use HTTP fallback
          logger.warn({ 
            err: sdkError?.message,
            stack: sdkError?.stack,
            code: sdkError?.code,
            name: sdkError?.name,
            uid: user.uid 
          }, 'Gemini SDK not available, using HTTP fallback');
          
          useHttpFallback = true;
          
          try {
            logger.info({ uid: user.uid, messageLength: body.message.length }, 'Calling Gemini API via HTTP');
            text = await callGeminiAPIHttp(geminiApiKey, fullPrompt);
            logger.info({ uid: user.uid, responseLength: text.length }, 'Gemini API call successful via HTTP');
          } catch (httpError: any) {
            logger.error({ 
              err: httpError, 
              stack: httpError?.stack,
              message: httpError?.message,
              code: httpError?.code,
              status: httpError?.response?.status,
              statusText: httpError?.response?.statusText,
              responseData: httpError?.response?.data ? JSON.stringify(httpError.response.data).substring(0, 500) : undefined,
              uid: user.uid 
            }, 'Gemini API HTTP call failed');
            
            // Provide more specific error messages
            let errorMessage = 'Sorry, I encountered an error processing your request. Please try again in a moment.';
            if (httpError?.response?.status === 401 || httpError?.response?.status === 403) {
              errorMessage = 'API key error. Please contact support.';
            } else if (httpError?.response?.status === 429) {
              errorMessage = 'Service is temporarily busy. Please try again in a moment.';
            } else if (httpError?.code === 'ENOTFOUND' || httpError?.code === 'ECONNREFUSED' || httpError?.code === 'ETIMEDOUT') {
              errorMessage = 'Network error. Please check your connection and try again.';
            } else if (httpError?.response?.data?.error?.message) {
              errorMessage = `API error: ${httpError.response.data.error.message}`;
            } else if (httpError?.message) {
              errorMessage = `Error: ${httpError.message}`;
            }
            
            return reply.code(500).send({
              error: 'Failed to generate response',
              reply: errorMessage,
              details: process.env.NODE_ENV === 'development' ? {
                message: httpError?.message,
                status: httpError?.response?.status,
                responseData: httpError?.response?.data,
              } : undefined,
            });
          }
        }

        const latency = Date.now() - startTime;

        // Log request (without API key)
        logger.info({
          uid: user.uid,
          messageLength: body.message.length,
          responseLength: text.length,
          latency,
          method: useHttpFallback ? 'HTTP' : 'SDK',
        }, 'Chatbot request processed successfully');

        // Return response with 'reply' field
        return {
          reply: text,
        };
      } catch (err: any) {
        // Handle validation errors
        if (err instanceof z.ZodError) {
          logger.warn({ errors: err.errors, uid: user?.uid }, 'Chatbot request validation failed');
          return reply.code(400).send({
            error: 'Invalid request',
            details: err.errors,
            reply: 'Please provide a valid message (1-2000 characters).',
          });
        }

        // Log the full error for debugging
        logger.error({ 
          err, 
          stack: err?.stack,
          message: err?.message,
          name: err?.name,
          code: err?.code,
          uid: user?.uid || 'unknown',
          requestBody: request.body ? JSON.stringify(request.body).substring(0, 100) : undefined,
        }, 'Error processing chatbot request');
        
        // Always return a reply field, even on error
        const errorMessage = err?.message || 'Unknown error';
        
        // Don't expose internal error details in production
        const userFriendlyMessage = process.env.NODE_ENV === 'development' 
          ? `Sorry, I encountered an error: ${errorMessage}. Please try again.`
          : 'Sorry, I encountered an error processing your request. Please try again.';
        
        return reply.code(500).send({
          error: 'Failed to process chatbot request',
          reply: userFriendlyMessage,
          details: process.env.NODE_ENV === 'development' ? {
            message: err?.message,
            stack: err?.stack,
            name: err?.name,
            code: err?.code,
          } : undefined,
        });
      }
    } catch (outerError: any) {
      // Catch any errors from preHandler or route setup that weren't caught by inner handlers
      logger.error({ 
        err: outerError, 
        stack: outerError?.stack,
        message: outerError?.message,
      }, 'Unhandled error in chatbot route (preHandler or setup)');
      
      // Check if response was already sent
      if (!reply.sent) {
        return reply.code(500).send({
          error: 'Internal server error',
          reply: 'Sorry, I encountered an error processing your request. Please try again.',
          details: process.env.NODE_ENV === 'development' ? outerError?.message : undefined,
        });
      }
    }
  });
}

