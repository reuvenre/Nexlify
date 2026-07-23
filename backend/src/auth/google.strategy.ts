import { Injectable, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback, Profile } from 'passport-google-oauth20';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../users/users.service';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  private readonly logger = new Logger(GoogleStrategy.name);

  constructor(config: ConfigService, private users: UsersService) {
    const clientID = config.get<string>('GOOGLE_CLIENT_ID') || 'MISSING';
    const clientSecret = config.get<string>('GOOGLE_CLIENT_SECRET') || 'MISSING';
    const backendUrl = config.get<string>('BACKEND_URL') || 'http://localhost:3001';

    if (clientID === 'MISSING' || clientSecret === 'MISSING') {
      // Log warning but don't crash — Google login just won't work
      new Logger('GoogleStrategy').warn(
        'GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET not set — Google OAuth disabled',
      );
    }

    super({
      clientID,
      clientSecret,
      callbackURL: `${backendUrl}/auth/google/callback`,
      scope: ['email', 'profile'],
    });
  }

  async validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ) {
    const email = profile.emails?.[0]?.value;
    if (!email) return done(new Error('No email from Google'), undefined);

    // The Google profile carries the user's real full name — pass it through so a
    // user with no stored name gets it backfilled (the dashboard greeting uses it).
    const displayName = profile.displayName
      || [profile.name?.givenName, profile.name?.familyName].filter(Boolean).join(' ');

    const user = await this.users.findGoogleUserForLogin(email, profile.id, displayName);
    // No existing account → don't fail the strategy (that returns a bare 401); pass a
    // sentinel so the callback can redirect the user to register with a clear message.
    if (!user) return done(null, { notRegistered: true, email } as any);
    done(null, user);
  }
}
