import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { Clock, DollarSign, MapPin, Utensils, Hotel, Activity } from 'lucide-react';

export function DailyItinerary({ dailyItinerary }) {
  if (!dailyItinerary || dailyItinerary.length === 0) {
    return null;
  }

  const getIcon = (type) => {
    switch (type) {
      case 'meal': return <Utensils className="h-4 w-4" />;
      case 'accommodation': return <Hotel className="h-4 w-4" />;
      case 'activity': return <Activity className="h-4 w-4" />;
      case 'travel': return <MapPin className="h-4 w-4" />;
      default: return <Clock className="h-4 w-4" />;
    }
  };

  return (
    <Card data-testid="daily-itinerary-card" className="border-primary/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="h-5 w-5 text-primary" />
          Day-by-Day Itinerary
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {dailyItinerary.map((day, dayIdx) => (
            <div key={dayIdx} className="border-l-2 border-primary/30 pl-4">
              <div className="mb-3">
                <h3 className="font-heading font-semibold text-lg flex items-center gap-2">
                  <Badge className="bg-primary text-primary-foreground">Day {day.day}</Badge>
                  {day.title}
                </h3>
                <div className="flex flex-wrap gap-3 mt-2 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    {day.total_distance}
                  </span>
                  <span>•</span>
                  <span className="flex items-center gap-1">
                    <DollarSign className="h-3 w-3" />
                    {day.total_cost}
                  </span>
                  {day.accommodation && (
                    <>
                      <span>•</span>
                      <span className="flex items-center gap-1">
                        <Hotel className="h-3 w-3" />
                        {day.accommodation}
                      </span>
                    </>
                  )}
                </div>
              </div>

              <div className="space-y-3">
                {day.schedule.map((item, itemIdx) => (
                  <div key={itemIdx} className="flex gap-3 p-3 bg-accent/30 rounded-lg hover:bg-accent/50 transition-colors">
                    <div className="flex-shrink-0 w-20 text-sm font-medium font-mono text-primary">
                      {item.time}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 flex-1">
                          {getIcon(item.type)}
                          <span className="font-medium text-sm">{item.activity}</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span>{item.duration}</span>
                          {item.cost && (
                            <Badge variant="secondary" className="text-xs">{item.cost}</Badge>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}